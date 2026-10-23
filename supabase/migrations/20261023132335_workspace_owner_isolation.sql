-- Review-only until dedicated project provisioning is approved.
-- One owner per workspace in this phase. No data seeds, signup trigger or grants
-- to new users: an operator must explicitly provision an owner/workspace row.
create schema workspace_private;
revoke all on schema workspace_private from public, anon, authenticated;
grant usage on schema workspace_private to authenticated;

create function workspace_private.session_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    and exists (select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id');
$$;

create table workspace_private.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id),
  created_at timestamptz not null default now()
);
create table workspace_private.records (
  workspace_id uuid not null references workspace_private.workspaces(id),
  id text not null,
  body jsonb not null,
  primary key (workspace_id, id)
);
create table workspace_private.reports (
  workspace_id uuid not null references workspace_private.workspaces(id),
  event_id text not null,
  body jsonb not null,
  primary key (workspace_id, event_id)
);
create table workspace_private.history (
  workspace_id uuid not null references workspace_private.workspaces(id),
  id text not null,
  revision bigint not null,
  body jsonb not null,
  primary key (workspace_id, id, revision)
);
alter table workspace_private.workspaces enable row level security;
alter table workspace_private.workspaces force row level security;
alter table workspace_private.records enable row level security;
alter table workspace_private.records force row level security;
alter table workspace_private.reports enable row level security;
alter table workspace_private.reports force row level security;
alter table workspace_private.history enable row level security;
alter table workspace_private.history force row level security;
create policy owner_read on workspace_private.workspaces for select to authenticated
  using ((select workspace_private.session_active()) and owner_id = (select auth.uid()));
create policy owner_read on workspace_private.records for select to authenticated
  using ((select workspace_private.session_active()) and workspace_id in (select id from workspace_private.workspaces where owner_id = (select auth.uid())));
create policy owner_read on workspace_private.reports for select to authenticated
  using ((select workspace_private.session_active()) and workspace_id in (select id from workspace_private.workspaces where owner_id = (select auth.uid())));
create policy owner_read on workspace_private.history for select to authenticated
  using ((select workspace_private.session_active()) and workspace_id in (select id from workspace_private.workspaces where owner_id = (select auth.uid())));
revoke all on all tables in schema workspace_private from public, anon, authenticated;
grant select on all tables in schema workspace_private to authenticated;
-- No client INSERT/UPDATE/DELETE grants or write policies. Narrow private
-- SECURITY DEFINER functions are intentional transaction APIs, not an RLS fix.
-- They authenticate, derive the owner workspace and validate each operation.
-- Public wrappers are invoker functions. No service-role key is used by the app.

create function workspace_private.shape(v jsonb, required text[], optional text[] default '{}')
returns void language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(v) is distinct from 'object' or not (v ?& required)
    or exists (select 1 from jsonb_object_keys(v) k where not (k = any(required || optional))) then
    raise exception 'invalid_schema';
  end if;
end $$;
create function workspace_private.txt(v jsonb, lim integer default 2000)
returns text language plpgsql set search_path = '' as $$
declare t text := v #>> '{}';
begin
  if jsonb_typeof(v) is distinct from 'string' or t ~ '^[[:space:]]*$' or length(t) > lim then raise exception 'invalid_text'; end if;
  return t;
end $$;
create function workspace_private.identifier(v jsonb)
returns text language plpgsql set search_path = '' as $$
declare t text := workspace_private.txt(v,100);
begin
  if t !~ '^[a-zA-Z0-9_-]+$' then raise exception 'invalid_id'; end if;
  return t;
end $$;
create function workspace_private.choice(v jsonb, choices text[])
returns text language plpgsql set search_path = '' as $$
declare t text := workspace_private.txt(v,100);
begin
  if not (t = any(choices)) then raise exception 'invalid_enum'; end if;
  return t;
end $$;
create function workspace_private.owner_workspace()
returns uuid language plpgsql security definer set search_path = '' as $$
declare w uuid;
begin
  if not workspace_private.session_active() then raise exception 'auth_required'; end if;
  -- Ownership comes from a provisioned relational row, never user metadata.
  select id into w from workspace_private.workspaces where owner_id = auth.uid() for update;
  if w is null then raise exception 'workspace_not_provisioned'; end if;
  return w;
end $$;

create function workspace_private.snapshot()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w uuid := workspace_private.owner_workspace();
begin
  return jsonb_build_object('workspaceId',w,
    'records',coalesce((select jsonb_agg(body order by id) from workspace_private.records where workspace_id=w),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(body order by event_id) from workspace_private.reports where workspace_id=w),'[]'::jsonb));
end $$;

create function workspace_private.mutate(command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w uuid := workspace_private.owner_workspace(); rid text; kind text; expected bigint;
  old jsonb; d jsonb; next_data jsonb; result jsonb; status text; val text; revision bigint;
begin
  if octet_length(command::text)>65536 then raise exception 'payload_too_large'; end if;
  perform workspace_private.shape(command,array['id','kind','expectedRevision','data']);
  rid := workspace_private.identifier(command->'id');
  kind := workspace_private.choice(command->'kind',array['task','lesson','capture','registration','note','meeting']);
  if jsonb_typeof(command->'expectedRevision') is distinct from 'number'
    or (command->>'expectedRevision') !~ '^[0-9]+$' then raise exception 'invalid_revision'; end if;
  -- Validate before bigint conversion, and leave room for the next revision.
  if (command->>'expectedRevision')::numeric >= 9007199254740991 then raise exception 'invalid_revision'; end if;
  expected := (command->>'expectedRevision')::bigint;
  select body into old from workspace_private.records where workspace_id=w and id=rid;
  if coalesce((old->>'revision')::bigint,0) <> expected then raise exception 'revision_conflict'; end if;
  if old is not null and old->>'kind' <> kind then raise exception 'kind_conflict'; end if;
  d := command->'data';
  if kind='task' then
    perform workspace_private.shape(d,array['title','status','dueDate']);
    perform workspace_private.txt(d->'title',200);
    status := workspace_private.choice(d->'status',array['ready','in_progress','done']);
    if d->'dueDate' <> '""'::jsonb then
      val := workspace_private.txt(d->'dueDate',10);
      begin
        if val !~ '^\d{4}-\d{2}-\d{2}$' or to_char(val::date,'YYYY-MM-DD')<>val then raise exception 'invalid_date'; end if;
      exception when others then raise exception 'invalid_date'; end;
    end if;
    next_data := d || jsonb_build_object('completionSource',case when status='done' then 'owner_self_report' else null end);
  elsif kind='lesson' then
    perform workspace_private.shape(d,array['title','status','evidence']);
    perform workspace_private.txt(d->'title',200);
    status := workspace_private.choice(d->'status',array['not_started','in_progress','completed']);
    if status='completed' then perform workspace_private.txt(d->'evidence',1000); end if;
    next_data := d || jsonb_build_object('evidence',case when status='completed' then d->>'evidence' else '' end,'completionSource',case when status='completed' then 'self_reported' else null end);
  elsif kind='capture' then
    if old is null then raise exception 'capture_requires_report'; end if;
    perform workspace_private.shape(d,array['content','userAccepted','disposition']);
    perform workspace_private.txt(d->'content');
    if jsonb_typeof(d->'userAccepted') is distinct from 'boolean' then raise exception 'invalid_schema'; end if;
    status := workspace_private.choice(d->'disposition',array['proposed','accepted','rejected','archived']);
    if (status='accepted' and not (d->>'userAccepted')::boolean) or (status in ('proposed','rejected') and (d->>'userAccepted')::boolean) then raise exception 'inconsistent_acceptance'; end if;
    next_data := old->'data' || d || jsonb_build_object('correctedLocally',coalesce((old->'data'->>'correctedLocally')::boolean,false) or d->'content'<>old->'data'->'content','remoteAcknowledgement','not_exposed');
  elsif kind='registration' then
    perform workspace_private.shape(d,array['displayName','status','requestedScopes']);
    perform workspace_private.txt(d->'displayName',100);
    status := workspace_private.choice(d->'status',array['pending','approved_for_local_test','rejected','revoked']);
    if jsonb_typeof(d->'requestedScopes') is distinct from 'array' then raise exception 'invalid_scopes'; end if;
    if jsonb_array_length(d->'requestedScopes') not between 1 and 2 then raise exception 'invalid_scopes'; end if;
    for val in select workspace_private.choice(value,array['reports:append','captures:append']) from jsonb_array_elements(d->'requestedScopes') loop end loop;
    if old is null and status<>'pending' then raise exception 'registration_must_start_pending'; end if;
    if old->'data'->>'status' in ('rejected','revoked') then raise exception 'registration_closed'; end if;
    if old->'data'->>'status'='approved_for_local_test' and status<>'revoked' then raise exception 'invalid_transition'; end if;
    next_data := d || jsonb_build_object('identity','unverified','credentialIssued',false,'isTest',true);
  elsif kind='meeting' then
    perform workspace_private.shape(d,array['title','start','end']);
    perform workspace_private.txt(d->'title',200);
    perform workspace_private.txt(d->'start',40); perform workspace_private.txt(d->'end',40);
    begin
      if not isfinite((d->>'start')::timestamptz) or not isfinite((d->>'end')::timestamptz)
        or (d->>'end')::timestamptz <= (d->>'start')::timestamptz then raise exception 'invalid_interval'; end if;
    exception when others then raise exception 'invalid_interval'; end;
    next_data := d || jsonb_build_object('provenance','manual','calendarConnected',false);
  else
    perform workspace_private.shape(d,array['title','content']);
    perform workspace_private.txt(d->'title',200); perform workspace_private.txt(d->'content',4000);
    next_data := d;
  end if;
  revision := expected+1;
  result := jsonb_build_object('id',rid,'kind',kind,'revision',revision,'updatedAt',clock_timestamp(),'data',next_data);
  insert into workspace_private.records values(w,rid,result)
    on conflict (workspace_id,id) do update set body=excluded.body;
  insert into workspace_private.history values(w,rid,revision,result);
  return result;
end $$;

create function workspace_private.validate_report(r jsonb)
returns void language plpgsql set search_path = '' as $$
declare c jsonb; src jsonb; val text; ids text[] := '{}'; occurred timestamptz;
begin
  if octet_length(r::text)>65536 then raise exception 'payload_too_large'; end if;
  perform workspace_private.shape(r,array['schemaVersion','eventId','checkpointId','eventType','occurredAt','reportingMode','isTest','summary','source','entityRefs','captures']);
  perform workspace_private.choice(r->'schemaVersion',array['1']);
  perform workspace_private.identifier(r->'eventId'); perform workspace_private.identifier(r->'checkpointId');
  perform workspace_private.choice(r->'eventType',array['checkpoint_reported','output_reported','blocked_reported','capture_reported']);
  perform workspace_private.choice(r->'reportingMode',array['explicit_checkpoint']);
  perform workspace_private.txt(r->'summary',4000);
  val := workspace_private.txt(r->'occurredAt',40);
  begin
    occurred := val::timestamptz;
    if val !~ '^\d{4}-\d{2}-\d{2}T.*Z$' or occurred > now()+interval '5 minutes' then raise exception 'invalid_timestamp'; end if;
  exception when others then raise exception 'invalid_timestamp'; end;
  if jsonb_typeof(r->'isTest') is distinct from 'boolean' or jsonb_typeof(r->'captures') is distinct from 'array'
    or jsonb_typeof(r->'entityRefs') is distinct from 'array' then raise exception 'invalid_schema'; end if;
  if jsonb_array_length(r->'captures')>20 or jsonb_array_length(r->'entityRefs')>20 then raise exception 'invalid_schema'; end if;
  for val in select workspace_private.identifier(value) from jsonb_array_elements(r->'entityRefs') loop end loop;
  src := r->'source';
  perform workspace_private.shape(src,array['conversationRef','segmentRef','availability']);
  val := workspace_private.choice(src->'availability',array['available','not_exposed']);
  if src->'conversationRef'<>'null'::jsonb then perform workspace_private.txt(src->'conversationRef',500); end if;
  if src->'segmentRef'<>'null'::jsonb then perform workspace_private.txt(src->'segmentRef',500); end if;
  if (val='available' and src->'conversationRef'='null'::jsonb and src->'segmentRef'='null'::jsonb)
    or (val='not_exposed' and (src->'conversationRef'<>'null'::jsonb or src->'segmentRef'<>'null'::jsonb)) then raise exception 'invalid_schema'; end if;
  for c in select value from jsonb_array_elements(r->'captures') loop
    perform workspace_private.shape(c,array['captureId','revision','type','content','basis','disposition','sensitivity','remotePersistence']);
    val := workspace_private.identifier(c->'captureId');
    if val=any(ids) then raise exception 'duplicate_capture_id'; end if;
    ids := array_append(ids,val);
    if c->'revision'<>'1'::jsonb then raise exception 'invalid_revision'; end if;
    perform workspace_private.choice(c->'type',array['fact','preference','decision','goal','proposed_task','unresolved_question']);
    perform workspace_private.txt(c->'content');
    perform workspace_private.choice(c->'basis',array['explicit','inferred','unknown']);
    perform workspace_private.choice(c->'disposition',array['proposed','owner_approved']);
    perform workspace_private.choice(c->'sensitivity',array['ordinary']);
    perform workspace_private.choice(c->'remotePersistence',array['not_exposed']);
  end loop;
end $$;

create function workspace_private.ingest(report jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w uuid := workspace_private.owner_workspace(); prior jsonb; rcp jsonb; c jsonb; rec jsonb; rid text; ref text;
  committed timestamptz := clock_timestamp(); digest text;
  saved_records jsonb := '[]'::jsonb;
begin
  perform workspace_private.validate_report(report);
  -- Hash canonical JSONB text, never a digest supplied by the caller.
  digest := encode(sha256(convert_to(report::text,'UTF8')),'hex');
  select body into prior from workspace_private.reports where workspace_id=w and event_id=report->>'eventId';
  if prior is not null then
    if prior->'receipt'->>'payloadDigest'<>digest then raise exception 'idempotency_conflict'; end if;
    return prior->'receipt' || jsonb_build_object('status','duplicate');
  end if;
  for ref in select value #>> '{}' from jsonb_array_elements(report->'entityRefs') loop
    if not exists(select 1 from workspace_private.records where workspace_id=w and id=ref) then raise exception 'unknown_entity'; end if;
  end loop;
  for c in select value from jsonb_array_elements(report->'captures') loop
    rid := c->>'captureId';
    if exists(select 1 from workspace_private.records where workspace_id=w and id=rid) then raise exception 'capture_conflict'; end if;
    rec := jsonb_build_object('id',rid,'kind','capture','revision',1,'updatedAt',committed,'data',c || jsonb_build_object(
      'eventId',report->>'eventId','connectionId','current-assistant-explicit-relay','source',report->'source',
      'occurredAt',report->'occurredAt','receivedAt',committed,'isTest',report->'isTest','userAccepted',false,
      'reportedDisposition',c->'disposition','workspaceSaved',true,'remoteAcknowledgement','not_exposed','correctedLocally',false,'entityRefs',report->'entityRefs'));
    insert into workspace_private.records values(w,rid,rec);
    insert into workspace_private.history values(w,rid,1,rec);
    saved_records := saved_records || jsonb_build_array(jsonb_build_object('id',rid,'revision',1));
  end loop;
  rcp := jsonb_build_object('eventId',report->>'eventId','receiptId',gen_random_uuid(),'payloadDigest',digest,
    'workspaceId',w,'committedAt',committed,'records',saved_records,'status','saved','remotePersistence','not_verified');
  insert into workspace_private.reports values(w,report->>'eventId',jsonb_build_object('connectionId','current-assistant-explicit-relay','report',report,'receipt',rcp));
  return rcp;
end $$;
create function workspace_private.receipt(event_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w uuid := workspace_private.owner_workspace(); result jsonb;
begin
  perform workspace_private.identifier(to_jsonb(event_id));
  select body->'receipt' into result from workspace_private.reports r where r.workspace_id=w and r.event_id=receipt.event_id;
  return result;
end $$;

create function public.workspace_snapshot() returns jsonb language sql security invoker set search_path = '' as $$ select workspace_private.snapshot(); $$;
create function public.workspace_mutate(command jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select workspace_private.mutate(command); $$;
create function public.workspace_ingest(report jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select workspace_private.ingest(report); $$;
create function public.workspace_receipt(event_id text) returns jsonb language sql security invoker set search_path = '' as $$ select workspace_private.receipt(event_id); $$;
revoke all on all functions in schema workspace_private from public, anon, authenticated;
revoke all on function public.workspace_snapshot(),public.workspace_mutate(jsonb),public.workspace_ingest(jsonb),public.workspace_receipt(text) from public, anon, authenticated;
grant execute on function workspace_private.snapshot(),workspace_private.mutate(jsonb),workspace_private.ingest(jsonb),workspace_private.receipt(text) to authenticated;
grant execute on function workspace_private.session_active() to authenticated;
grant execute on function public.workspace_snapshot(),public.workspace_mutate(jsonb),public.workspace_ingest(jsonb),public.workspace_receipt(text) to authenticated;
