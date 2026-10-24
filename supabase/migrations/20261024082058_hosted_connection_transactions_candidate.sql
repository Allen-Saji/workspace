-- UNAPPLIED CANDIDATE. Requires the connection_persistence_candidate first.
-- No client EXECUTE grants, and the database activation switch defaults OFF.
-- Never apply with db push until the complete access boundary is approved.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
  if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto' and n.nspname='extensions') then
    raise exception 'pgcrypto must be reviewed in its existing schema';
  end if;
end $$;
create table workspace_private.agent_activation (singleton boolean primary key default true check(singleton), enabled boolean not null default false);
insert into workspace_private.agent_activation values(true,false);
create table workspace_private.agent_limits(bucket text primary key, window_at timestamptz not null, attempts integer not null);
create table workspace_private.agent_events(
  connection_id uuid not null references workspace_private.agent_connections(id),
  event_id text not null, report_key text not null, primary key(connection_id,event_id)
);
alter table workspace_private.agent_activation enable row level security;
alter table workspace_private.agent_activation force row level security;
alter table workspace_private.agent_limits enable row level security;
alter table workspace_private.agent_limits force row level security;
alter table workspace_private.agent_events enable row level security;
alter table workspace_private.agent_events force row level security;
revoke all on workspace_private.agent_activation,workspace_private.agent_limits,workspace_private.agent_events from public,anon,authenticated;

create function workspace_private.agent_hash(value text) returns text language sql immutable set search_path='' as $$
  select translate(rtrim(encode(sha256(convert_to(value,'UTF8')),'base64'),'='),'+/','-_');
$$;
create function workspace_private.agent_secret() returns text language sql volatile set search_path='' as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_');
$$;
create function workspace_private.agent_scopes(value jsonb) returns text[] language plpgsql set search_path='' as $$
declare result text[];
begin
  if jsonb_typeof(value) is distinct from 'array' then raise exception 'scope_denied'; end if;
  select array_agg(s order by s) into result from jsonb_array_elements_text(value) s;
  if cardinality(result) not between 1 and 3 or result is null
    or not result <@ array['reports:append','captures:append','receipts:read'] or not 'reports:append'=any(result)
    or cardinality(result)<>(select count(distinct s) from unnest(result) s) then raise exception 'scope_denied'; end if;
  return result;
end $$;
create function workspace_private.agent_view(c workspace_private.agent_connections) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',c.id,'displayName',c.display_name,'requestedScopes',c.requested_scopes,'grantedScopes',c.granted_scopes,
    'status',case when c.status not in ('rejected','revoked') and (case when c.status='active' then c.token_expires_at else c.setup_expires_at end)<=now() then 'expired' else c.status end,
    'expiresAt',case when c.status='active' then c.token_expires_at else c.setup_expires_at end,
    'identity','unverified','isTest',false,'generation',c.generation,
    'lastReportedAt',(select max((r.body->'report'->>'occurredAt')::timestamptz) from workspace_private.agent_events e join workspace_private.reports r on r.workspace_id=c.workspace_id and r.event_id=e.report_key where e.connection_id=c.id),
    'lastReceivedAt',(select max((r.body->'receipt'->>'committedAt')::timestamptz) from workspace_private.agent_events e join workspace_private.reports r on r.workspace_id=c.workspace_id and r.event_id=e.report_key where e.connection_id=c.id));
$$;
-- Bounded, global transport buckets intentionally trade availability for a small
-- attack surface. Errors return through the outer RPC, so failed attempts commit.
create function workspace_private.agent_budget(bucket_key text, maximum integer) returns boolean language plpgsql set search_path='' as $$
declare n integer; current_window timestamptz:=date_trunc('minute',clock_timestamp());
begin
  insert into workspace_private.agent_limits values(bucket_key,current_window,1)
    on conflict(bucket) do update set window_at=excluded.window_at,attempts=case when agent_limits.window_at=excluded.window_at then least(agent_limits.attempts+1,1000000) else 1 end
    returning attempts into n;
  return n<=maximum;
end $$;

create function workspace_private.agent_control_body(command jsonb) returns jsonb language plpgsql set search_path='' as $$
declare w uuid:=workspace_private.owner_workspace(); a text; c workspace_private.agent_connections; chosen text[]; code text;
begin
  perform workspace_private.shape(command,array['action'],array['id','scopes']);
  a:=workspace_private.choice(command->'action',array['list','pair','approve','reject','revoke']);
  if a in ('list','pair') then
    perform workspace_private.shape(command,array['action']);
    if a='list' then return jsonb_build_object('connections',coalesce((select jsonb_agg(workspace_private.agent_view(x) order by x.created_at desc) from workspace_private.agent_connections x where workspace_id=w),'[]'::jsonb),'testOnly',false); end if;
    code:=workspace_private.agent_secret();
    insert into workspace_private.agent_pairings(code_hash,workspace_id,expires_at) values(workspace_private.agent_hash(code),w,now()+interval '10 minutes');
    return jsonb_build_object('pairingCode',code,'expiresAt',now()+interval '10 minutes','isTest',false);
  end if;
  perform workspace_private.shape(command,array['action','id'],case when a='approve' then array['scopes'] else '{}'::text[] end);
  select * into c from workspace_private.agent_connections where id=(command->>'id')::uuid and workspace_id=w for update;
  if c.id is null then raise exception 'scope_denied'; end if;
  if a='revoke' then
    update workspace_private.agent_connections set status='revoked' where id=c.id returning * into c;
    delete from workspace_private.agent_token_hashes where connection_id=c.id;
  else
    if c.status<>'pending' or c.setup_expires_at<=now() then raise exception 'registration_closed'; end if;
    if a='approve' then
      chosen:=workspace_private.agent_scopes(command->'scopes');
      if not chosen <@ c.requested_scopes then raise exception 'scope_denied'; end if;
      update workspace_private.agent_connections set status='approved',granted_scopes=chosen where id=c.id returning * into c;
    else update workspace_private.agent_connections set status='rejected' where id=c.id returning * into c; end if;
  end if;
  return workspace_private.agent_view(c);
end $$;

create function workspace_private.agent_transport_body(action text, credential text, payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare p workspace_private.agent_pairings; c workspace_private.agent_connections; w uuid; cid uuid; wanted text[];
  req text; challenge text; name text; digest text; token text; h text; report jsonb; prior jsonb; rcp jsonb; cap jsonb; rec jsonb;
  rid text; report_key text; event text; saved jsonb:='[]'::jsonb; committed timestamptz:=clock_timestamp();
begin
  if action='registrations' then
    perform workspace_private.shape(payload,array['pairingCode','requestId','displayName','requestedScopes','codeChallenge','codeChallengeMethod']);
    token:=workspace_private.txt(payload->'pairingCode',43);
    if token !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'auth_required'; end if;
    req:=workspace_private.identifier(payload->'requestId'); name:=workspace_private.txt(payload->'displayName',100);
    wanted:=workspace_private.agent_scopes(payload->'requestedScopes'); challenge:=workspace_private.txt(payload->'codeChallenge',43);
    if challenge !~ '^[A-Za-z0-9_-]{43}$' or payload->>'codeChallengeMethod'<>'S256' then raise exception 'invalid_schema'; end if;
    h:=workspace_private.agent_hash(token);
    select workspace_id into w from workspace_private.agent_pairings where code_hash=h;
    if w is null then raise exception 'auth_required'; end if;
    -- All paths lock workspace before connection: approval/revoke cannot deadlock
    -- or race between authorization and receipt commit.
    perform 1 from workspace_private.workspaces where id=w for update;
    select * into p from workspace_private.agent_pairings where code_hash=h for update;
    if p.expires_at<=now() then raise exception 'auth_required'; end if;
    digest:=workspace_private.agent_hash(jsonb_build_object('request',req,'name',name,'scopes',wanted,'challenge',challenge)::text);
    if p.connection_id is not null then
      if p.request_id<>req or p.request_digest<>digest then raise exception 'idempotency_conflict'; end if;
      select * into c from workspace_private.agent_connections where id=p.connection_id;
      return workspace_private.agent_view(c);
    end if;
    insert into workspace_private.agent_connections(workspace_id,display_name,requested_scopes,status,setup_challenge,setup_expires_at)
      values(w,name,wanted,'pending',challenge,p.expires_at) returning * into c;
    update workspace_private.agent_pairings set request_id=req,request_digest=digest,connection_id=c.id where code_hash=h;
    return workspace_private.agent_view(c);
  end if;
  if action='exchange' then
    perform workspace_private.shape(payload,array['registrationId','codeVerifier']);
    token:=workspace_private.txt(payload->'codeVerifier',128);
    if token !~ '^[A-Za-z0-9._~-]{43,128}$' then raise exception 'auth_required'; end if;
    cid:=(payload->>'registrationId')::uuid;
    select workspace_id into w from workspace_private.agent_connections where id=cid;
  else
    if credential is null or credential !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'auth_required'; end if;
    h:=workspace_private.agent_hash(credential);
    select x.workspace_id,x.id into w,cid from workspace_private.agent_connections x join workspace_private.agent_token_hashes t on t.connection_id=x.id where t.token_hash=h;
  end if;
  if w is null then raise exception 'auth_required'; end if;
  perform 1 from workspace_private.workspaces where id=w for update;
  select * into c from workspace_private.agent_connections where id=cid for update;
  if action='exchange' then
    if c.setup_challenge<>workspace_private.agent_hash(token) then raise exception 'auth_required'; end if;
    if c.setup_expires_at<=now() then raise exception 'registration_closed'; end if;
    if c.status='pending' then return jsonb_build_object('status','pending','nextPollSeconds',5,'isTest',false); end if;
    if c.status<>'approved' then raise exception 'registration_closed'; end if;
  else
    -- Recheck AFTER the shared workspace lock, including token generation.
    if c.status<>'active' or c.token_expires_at<=now() or not exists(select 1 from workspace_private.agent_token_hashes t where t.token_hash=h and t.connection_id=c.id and t.generation=c.generation and t.expires_at>now()) then raise exception 'auth_required'; end if;
    if not (case when action='receipts' then 'receipts:read' else 'reports:append' end)=any(c.granted_scopes) then raise exception 'scope_denied'; end if;
  end if;
  if action in ('exchange','rotate') then
    if action='rotate' then perform workspace_private.shape(payload,'{}'); end if;
    token:=workspace_private.agent_secret();
    update workspace_private.agent_connections set status='active',generation=generation+1,token_expires_at=now()+interval '1 hour' where id=c.id returning * into c;
    delete from workspace_private.agent_token_hashes where connection_id=c.id;
    insert into workspace_private.agent_token_hashes values(workspace_private.agent_hash(token),c.id,c.generation,c.token_expires_at);
    return jsonb_build_object('status','active','connectionId',c.id,'accessToken',token,'tokenType','Bearer','grantedScopes',c.granted_scopes,'expiresAt',c.token_expires_at,'isTest',false);
  end if;
  if action='receipts' then
    perform workspace_private.shape(payload,array['eventId']); event:=workspace_private.identifier(payload->'eventId');
    select r.body->'receipt' into rcp from workspace_private.agent_events e join workspace_private.reports r on r.workspace_id=w and r.event_id=e.report_key where e.connection_id=c.id and e.event_id=event;
    return jsonb_build_object('receipt',rcp);
  end if;
  if action<>'events' then raise exception 'scope_denied'; end if;
  report:=payload; perform workspace_private.validate_report(report);
  if jsonb_array_length(report->'entityRefs')<>0 then raise exception 'scope_denied'; end if;
  if jsonb_array_length(report->'captures')>0 and not 'captures:append'=any(c.granted_scopes) then raise exception 'scope_denied'; end if;
  event:=report->>'eventId'; digest:=encode(sha256(convert_to(report::text,'UTF8')),'hex');
  select r.body into prior from workspace_private.agent_events e join workspace_private.reports r on r.workspace_id=w and r.event_id=e.report_key where e.connection_id=c.id and e.event_id=event;
  if prior is not null then
    if prior->'receipt'->>'payloadDigest'<>digest then raise exception 'idempotency_conflict'; end if;
    return prior->'receipt'||jsonb_build_object('status','duplicate');
  end if;
  -- ':' is outside owner relay identifier syntax, preventing namespace collisions.
  report_key:='agent:'||c.id::text||':'||event;
  for cap in select value from jsonb_array_elements(report->'captures') loop
    rid:='agent_'||workspace_private.agent_hash(c.id::text||':'||(cap->>'captureId'));
    if exists(select 1 from workspace_private.records where workspace_id=w and id=rid) then raise exception 'capture_conflict'; end if;
    rec:=jsonb_build_object('id',rid,'kind','capture','revision',1,'updatedAt',committed,'data',cap||jsonb_build_object('captureId',rid,
      'eventId',event,'connectionId',c.id,'source',report->'source','occurredAt',report->'occurredAt','receivedAt',committed,'isTest',report->'isTest',
      'userAccepted',false,'reportedDisposition',cap->'disposition','workspaceSaved',true,'remoteAcknowledgement','not_exposed','correctedLocally',false,'entityRefs','[]'::jsonb));
    insert into workspace_private.records values(w,rid,rec); insert into workspace_private.history values(w,rid,1,rec);
    saved:=saved||jsonb_build_array(jsonb_build_object('id',rid,'revision',1));
  end loop;
  rcp:=jsonb_build_object('eventId',event,'receiptId',gen_random_uuid(),'payloadDigest',digest,'workspaceId',w,'committedAt',committed,'records',saved,'status','saved','remotePersistence','not_verified');
  insert into workspace_private.reports values(w,report_key,jsonb_build_object('connectionId',c.id,'report',report,'receipt',rcp));
  insert into workspace_private.agent_events values(c.id,event,report_key);
  return rcp;
end $$;

-- Deliberate capability boundary: control requires ordinary confirmed owner Auth;
-- transport authenticates an opaque scoped credential, never a spoofed Auth JWT.
-- No access is granted by this candidate. Review direct Data API exposure first.
create function workspace_private.agent_rpc(action text, credential text, payload jsonb, owner_control boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare bucket text; budget integer;
begin
  if not coalesce((select enabled from workspace_private.agent_activation where singleton),false) then return jsonb_build_object('error','connections_disabled'); end if;
  if owner_control then
    if not workspace_private.session_active() or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then return jsonb_build_object('error','auth_required'); end if;
    bucket:='owner:'||auth.uid()::text; budget:=30;
  else
    if action is null or action not in ('registrations','exchange','rotate','events','receipts') then return jsonb_build_object('error','scope_denied'); end if;
    bucket:='transport:'||action; budget:=case when action in ('events','receipts') then 120 else 30 end;
  end if;
  if not workspace_private.agent_budget(bucket,budget) then return jsonb_build_object('error','rate_limited'); end if;
  begin
    if payload is null or octet_length(payload::text)>65536 or length(coalesce(credential,''))>128 then raise exception 'payload_too_large'; end if;
    if owner_control then return workspace_private.agent_control_body(payload); end if;
    return workspace_private.agent_transport_body(action,credential,payload);
  exception when others then
    -- Do not leak constraint detail, raw parameters or SQL messages to clients.
    if sqlerrm=any(array['auth_required','scope_denied','workspace_not_provisioned','invalid_schema','invalid_text','invalid_enum','invalid_id','registration_closed','idempotency_conflict','capture_conflict','payload_too_large','invalid_timestamp','duplicate_capture_id','invalid_revision']) then return jsonb_build_object('error',sqlerrm); end if;
    return jsonb_build_object('error','storage_unavailable');
  end;
end $$;
create function public.workspace_agent_control(command jsonb) returns jsonb language sql security invoker set search_path='' as $$ select workspace_private.agent_rpc('control',null,command,true); $$;
create function public.workspace_agent_transport(action text, credential text, payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select workspace_private.agent_rpc(action,credential,payload,false); $$;
revoke all on function workspace_private.agent_hash(text),workspace_private.agent_secret(),workspace_private.agent_scopes(jsonb),workspace_private.agent_view(workspace_private.agent_connections),workspace_private.agent_budget(text,integer),workspace_private.agent_control_body(jsonb),workspace_private.agent_transport_body(text,text,jsonb),workspace_private.agent_rpc(text,text,jsonb,boolean),public.workspace_agent_control(jsonb),public.workspace_agent_transport(text,text,jsonb) from public,anon,authenticated;
-- Activation grants deliberately omitted. Only isolated tests enable this candidate.

