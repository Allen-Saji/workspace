-- Owner-only personal journals. Agent transport activation is unchanged.
create table workspace_private.personal_journals (
  workspace_id uuid not null references workspace_private.workspaces(id),
  local_date date not null,
  timezone text not null,
  content text not null check (length(content) between 1 and 12000),
  revision bigint not null check (revision > 0 and revision < 9007199254740991),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, local_date)
);
create table workspace_private.personal_journal_versions (
  workspace_id uuid not null,
  local_date date not null,
  revision bigint not null,
  request_id text not null,
  digest text not null,
  body jsonb not null,
  primary key (workspace_id, request_id),
  unique (workspace_id, local_date, revision),
  foreign key (workspace_id, local_date) references workspace_private.personal_journals(workspace_id, local_date)
);
alter table workspace_private.personal_journals enable row level security;
alter table workspace_private.personal_journals force row level security;
alter table workspace_private.personal_journal_versions enable row level security;
alter table workspace_private.personal_journal_versions force row level security;
revoke all on workspace_private.personal_journals, workspace_private.personal_journal_versions from public, anon, authenticated;

create function workspace_private.personal_journal(action text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w uuid := workspace_private.owner_workspace();
  day date; zone text; content text; expected bigint; request text; hash text;
  old workspace_private.personal_journals;
  prior workspace_private.personal_journal_versions;
  entry jsonb; received timestamptz := clock_timestamp();
begin
  if action = 'agents' then
    perform workspace_private.shape(payload, array[]::text[]);
    -- Owners can read saved history even when new agent publishing is disabled.
    return jsonb_build_object(
      'diaries', coalesce((select jsonb_agg(body order by local_date desc, connection_id) from
        (select local_date, connection_id, body from workspace_private.agent_diaries where workspace_id=w order by local_date desc, connection_id limit 100) d), '[]'::jsonb),
      'names', coalesce((select jsonb_object_agg(id::text, display_name) from workspace_private.agent_connections where workspace_id=w), '{}'::jsonb),
      'enabled', coalesce((select enabled from workspace_private.agent_activation where singleton), false));
  end if;
  if action is null or action not in ('day','history','save') then raise exception 'invalid_schema'; end if;
  perform workspace_private.shape(payload, case when action='save'
    then array['requestId','localDate','timezone','content','expectedRevision'] else array['localDate'] end);
  if jsonb_typeof(payload->'localDate') is distinct from 'string' or payload->>'localDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_date'; end if;
  begin day := (payload->>'localDate')::date;
  exception when others then raise exception 'invalid_date'; end;
  if to_char(day,'YYYY-MM-DD') <> payload->>'localDate' then raise exception 'invalid_date'; end if;
  select * into old from workspace_private.personal_journals where workspace_id=w and local_date=day;
  if action='day' then
    return jsonb_build_object('entry', case when old.workspace_id is null then null else
      jsonb_build_object('localDate',old.local_date,'timezone',old.timezone,'content',old.content,'revision',old.revision,'updatedAt',old.updated_at) end,
      'recent', coalesce((select jsonb_agg(jsonb_build_object('localDate',local_date,'revision',revision,'updatedAt',updated_at) order by local_date desc)
        from (select local_date,revision,updated_at from workspace_private.personal_journals where workspace_id=w order by local_date desc limit 90) recent), '[]'::jsonb));
  end if;
  if action='history' then
    return jsonb_build_object('entries', coalesce((select jsonb_agg(body order by revision desc) from
      (select revision,body from workspace_private.personal_journal_versions where workspace_id=w and local_date=day order by revision desc limit 20) versions), '[]'::jsonb));
  end if;
  zone := workspace_private.txt(payload->'timezone',100);
  if (zone<>'UTC' and position('/' in zone)=0) or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'invalid_timezone'; end if;
  if day > (received at time zone zone)::date then raise exception 'journal_future_date'; end if;
  request := workspace_private.identifier(payload->'requestId');
  content := workspace_private.txt(payload->'content',12000);
  if jsonb_typeof(payload->'expectedRevision') is distinct from 'number' or payload->>'expectedRevision' !~ '^[0-9]+$'
    or (payload->>'expectedRevision')::numeric >= 9007199254740991 then raise exception 'invalid_revision'; end if;
  expected := (payload->>'expectedRevision')::bigint;
  hash := encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  select * into prior from workspace_private.personal_journal_versions where workspace_id=w and request_id=request;
  if found then
    if prior.digest<>hash then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('entry',prior.body);
  end if;
  if coalesce(old.revision,0)<>expected then raise exception 'journal_revision_conflict'; end if;
  if old.workspace_id is not null and old.timezone<>zone then raise exception 'timezone_conflict'; end if;
  entry := jsonb_build_object('localDate',day,'timezone',zone,'content',content,'revision',expected+1,'updatedAt',received);
  insert into workspace_private.personal_journals(workspace_id,local_date,timezone,content,revision,updated_at)
    values(w,day,zone,content,expected+1,received)
    on conflict(workspace_id,local_date) do update set content=excluded.content,revision=excluded.revision,updated_at=excluded.updated_at;
  insert into workspace_private.personal_journal_versions(workspace_id,local_date,revision,request_id,digest,body)
    values(w,day,expected+1,request,hash,entry);
  return jsonb_build_object('entry',entry);
end $$;
create function public.workspace_personal_journal(action text, payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select workspace_private.personal_journal(action,payload); $$;
revoke all on function workspace_private.personal_journal(text,jsonb), public.workspace_personal_journal(text,jsonb) from public, anon, authenticated;
grant execute on function workspace_private.personal_journal(text,jsonb), public.workspace_personal_journal(text,jsonb) to authenticated;
