-- UNAPPLIED v2 candidate. Requires both connection candidates; activates nothing.
-- v1 reports/receipts remain unchanged. Journal receipts have their own namespace.
create table workspace_private.agent_diaries(
 workspace_id uuid not null references workspace_private.workspaces(id),connection_id uuid not null references workspace_private.agent_connections(id),local_date date not null,body jsonb not null,primary key(workspace_id,connection_id,local_date));
create table workspace_private.agent_journal_events(
 workspace_id uuid not null references workspace_private.workspaces(id),connection_id uuid not null references workspace_private.agent_connections(id),event_id text not null,body jsonb not null,primary key(workspace_id,connection_id,event_id));
alter table workspace_private.agent_diaries enable row level security;
alter table workspace_private.agent_diaries force row level security;
alter table workspace_private.agent_journal_events enable row level security;
alter table workspace_private.agent_journal_events force row level security;
revoke all on workspace_private.agent_diaries,workspace_private.agent_journal_events from public,anon,authenticated;
create function workspace_private.validate_journal(v jsonb) returns void language plpgsql set search_path='' as $$
declare kind text; observed timestamptz; sent timestamptz; zone text; item jsonb; field text; val text;
begin
 if octet_length(v::text)>32768 then raise exception 'payload_too_large'; end if;
 kind:=workspace_private.choice(v->'kind',array['diary','status']);
 perform workspace_private.shape(v,array['schemaVersion','kind','eventId','observedAt','sentAt','isTest','summary','evidence']||case when kind='diary' then array['localDate','timezone','expectedRevision','results','blockers','nextSteps'] else array['state'] end);
 perform workspace_private.choice(v->'schemaVersion',array['2']);perform workspace_private.identifier(v->'eventId');perform workspace_private.txt(v->'summary',2000);
 foreach field in array array['observedAt','sentAt'] loop
  val:=workspace_private.txt(v->field,30);
  if val !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' then raise exception 'invalid_timestamp'; end if;
  begin if not isfinite(val::timestamptz) or val::timestamptz>now()+interval '5 minutes' then raise exception 'invalid_timestamp'; end if;
  exception when others then raise exception 'invalid_timestamp'; end;
 end loop;
 observed:=(v->>'observedAt')::timestamptz;sent:=(v->>'sentAt')::timestamptz;
 if observed>sent then raise exception 'invalid_timestamp'; end if;
 if jsonb_typeof(v->'isTest') is distinct from 'boolean' or jsonb_typeof(v->'evidence') is distinct from 'array' then raise exception 'invalid_schema'; end if;
 if jsonb_array_length(v->'evidence')>10 then raise exception 'invalid_schema'; end if;
 for item in select value from jsonb_array_elements(v->'evidence') loop
  perform workspace_private.shape(item,array['label','url']);perform workspace_private.txt(item->'label',200);val:=workspace_private.txt(item->'url',1000);
  if val !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[^?#[:space:]]*)?$' then raise exception 'invalid_evidence'; end if;
 end loop;
 if kind='status' then perform workspace_private.choice(v->'state',array['working','completed','blocked','offline']);return; end if;
 zone:=workspace_private.txt(v->'timezone',100);
 if (zone<>'UTC' and position('/' in zone)=0) or not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'invalid_timezone'; end if;
 if v->>'localDate'<>to_char(observed at time zone zone,'YYYY-MM-DD') or v->>'localDate'>to_char(now() at time zone zone,'YYYY-MM-DD') then raise exception 'invalid_local_date'; end if;
 if jsonb_typeof(v->'expectedRevision') is distinct from 'number' or v->>'expectedRevision' !~ '^[0-9]+$' or (v->>'expectedRevision')::numeric>=9007199254740991 then raise exception 'invalid_revision'; end if;
 foreach field in array array['results','blockers','nextSteps'] loop
  if jsonb_typeof(v->field) is distinct from 'array' then raise exception 'invalid_schema'; end if;
  if jsonb_array_length(v->field)>20 then raise exception 'invalid_schema'; end if;
  for item in select value from jsonb_array_elements(v->field) loop perform workspace_private.txt(item,1000);end loop;
 end loop;
end $$;
create function workspace_private.agent_journal_write(action text,credential text,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare c workspace_private.agent_connections; w uuid; cid uuid; h text; prior jsonb; old jsonb; report jsonb:=payload; rcp jsonb; entry jsonb; digest text; received timestamptz:=clock_timestamp(); expected bigint; event text;
begin
 if credential is null or credential !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'auth_required'; end if;
 h:=workspace_private.agent_hash(credential);
 select x.workspace_id,x.id into w,cid from workspace_private.agent_connections x join workspace_private.agent_token_hashes t on t.connection_id=x.id where t.token_hash=h;
 if w is null then raise exception 'auth_required'; end if;
 perform 1 from workspace_private.workspaces where id=w for update;
 select * into c from workspace_private.agent_connections where id=cid for update;
 if c.status<>'active' or c.token_expires_at<=now() or not exists(select 1 from workspace_private.agent_token_hashes t where t.token_hash=h and t.connection_id=cid and t.generation=c.generation and t.expires_at>now()) then raise exception 'auth_required'; end if;
 if not (case when action='receipts' then 'receipts:read' else 'reports:append' end)=any(c.granted_scopes) then raise exception 'scope_denied'; end if;
 if action='receipts' then
  perform workspace_private.shape(payload,array['eventId']);event:=workspace_private.identifier(payload->'eventId');
  select body->'receipt' into rcp from workspace_private.agent_journal_events where workspace_id=w and connection_id=cid and event_id=event;return jsonb_build_object('receipt',rcp);
 end if;
 perform workspace_private.validate_journal(report);
 if report->>'kind'<>action then raise exception 'invalid_schema'; end if;
 event:=report->>'eventId';digest:=encode(sha256(convert_to(report::text,'UTF8')),'hex');
 select body->'receipt' into prior from workspace_private.agent_journal_events where workspace_id=w and connection_id=cid and event_id=event;
 if prior is not null then
  if prior->>'payloadDigest'<>digest then raise exception 'idempotency_conflict';end if;return prior||jsonb_build_object('status','duplicate');
 end if;
 rcp:=jsonb_build_object('eventId',event,'receiptId',gen_random_uuid(),'payloadDigest',digest,'receivedAt',received,'connectionId',cid,'kind',action,'status','saved');
 if action='diary' then
  expected:=(report->>'expectedRevision')::bigint;
  select body into old from workspace_private.agent_diaries where workspace_id=w and connection_id=cid and local_date=(report->>'localDate')::date;
  if coalesce((old->>'revision')::bigint,0)<>expected then raise exception 'revision_conflict';end if;
  if old is not null and old->>'timezone'<>report->>'timezone' then raise exception 'timezone_conflict';end if;
  entry:=jsonb_build_object('connectionId',cid,'localDate',report->>'localDate','timezone',report->>'timezone','revision',expected+1,'receivedAt',received,'report',report);
  insert into workspace_private.agent_diaries values(w,cid,(report->>'localDate')::date,entry) on conflict(workspace_id,connection_id,local_date) do update set body=excluded.body;
  rcp:=rcp||jsonb_build_object('localDate',report->>'localDate','revision',expected+1);
 end if;
 insert into workspace_private.agent_journal_events values(w,cid,event,jsonb_build_object('report',report,'receipt',rcp));return rcp;
end $$;
create function workspace_private.agent_journal_rpc(action text,credential text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not coalesce((select enabled from workspace_private.agent_activation where singleton),false) then return jsonb_build_object('error','connections_disabled');end if;
 if action is null or action not in ('diary','status','receipts') then return jsonb_build_object('error','scope_denied');end if;
 if not workspace_private.agent_budget('journal:'||action,120) then return jsonb_build_object('error','rate_limited');end if;
 begin return workspace_private.agent_journal_write(action,credential,payload);
 exception when others then
  if sqlerrm=any(array['auth_required','scope_denied','invalid_schema','invalid_text','invalid_id','invalid_enum','invalid_timestamp','invalid_timezone','invalid_evidence','invalid_local_date','invalid_revision','revision_conflict','timezone_conflict','idempotency_conflict','payload_too_large']) then return jsonb_build_object('error',sqlerrm);end if;
  return jsonb_build_object('error','storage_unavailable');
 end;
end $$;
create function workspace_private.agent_journal_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=workspace_private.owner_workspace();
begin
 if not coalesce((select enabled from workspace_private.agent_activation where singleton),false) then raise exception 'connections_disabled';end if;
 return jsonb_build_object('diaries',coalesce((select jsonb_agg(body order by local_date desc,connection_id) from workspace_private.agent_diaries where workspace_id=w),'[]'::jsonb),
 'statuses',coalesce((select jsonb_agg(jsonb_build_object('connectionId',connection_id,'report',body->'report','receivedAt',body->'receipt'->'receivedAt')) from
 (select distinct on(connection_id) connection_id,body from workspace_private.agent_journal_events where workspace_id=w and body->'report'->>'kind'='status'
 order by connection_id,(body->'report'->>'observedAt')::timestamptz desc,(body->'report'->>'sentAt')::timestamptz desc,event_id desc) latest),'[]'::jsonb));
end $$;
create function public.workspace_agent_journal_transport(action text,credential text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select workspace_private.agent_journal_rpc(action,credential,payload);$$;
create function public.workspace_agent_journal() returns jsonb language sql security invoker set search_path='' as $$select workspace_private.agent_journal_snapshot();$$;
revoke all on function workspace_private.validate_journal(jsonb),workspace_private.agent_journal_write(text,text,jsonb),workspace_private.agent_journal_rpc(text,text,jsonb),workspace_private.agent_journal_snapshot(),public.workspace_agent_journal_transport(text,text,jsonb),public.workspace_agent_journal() from public,anon,authenticated;
-- No activation or execute grants. Future journal read is owner-authenticated;
-- future transport is scoped-token authenticated. Never grant table/helper access.
