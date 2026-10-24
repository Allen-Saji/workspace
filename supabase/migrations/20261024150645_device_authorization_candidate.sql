-- UNAPPLIED. No execution grants; separate device activation defaults false.
create table workspace_private.device_activation(singleton boolean primary key check(singleton),enabled boolean not null);
insert into workspace_private.device_activation values(true,false);
create table workspace_private.device_requests(
 id uuid primary key default gen_random_uuid(),
 request_id text not null unique,
 request_digest text not null,
 display_name text not null,
 requested_scopes text[] not null,
 challenge text not null,
 expires_at timestamptz not null default now()+interval '10 minutes',
 status text not null default 'pending' check(status in ('pending','approved','denied','exchanged')),
 workspace_id uuid references workspace_private.workspaces(id),
 connection_id uuid unique references workspace_private.agent_connections(id),
 next_poll timestamptz not null default now(),
 poll_interval integer not null default 5 check(poll_interval between 5 and 60)
);
alter table workspace_private.device_activation enable row level security;
alter table workspace_private.device_activation force row level security;
alter table workspace_private.device_requests enable row level security;
alter table workspace_private.device_requests force row level security;
revoke all on workspace_private.device_activation,workspace_private.device_requests from public,anon,authenticated;
create function workspace_private.device_body(action text,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare d workspace_private.device_requests; w uuid; requested text[]; chosen text[]; challenge text; digest text; result jsonb; cid uuid;
begin
 if action='start' then
  perform workspace_private.shape(payload,array['requestId','displayName','requestedScopes','codeChallenge','codeChallengeMethod']);
  perform workspace_private.identifier(payload->'requestId');
  perform workspace_private.txt(payload->'displayName',100);
  requested:=workspace_private.agent_scopes(payload->'requestedScopes');
  -- Device v1 intentionally excludes captures.
  if not requested <@ array['reports:append','receipts:read'] then raise exception 'scope_denied'; end if;
  challenge:=workspace_private.txt(payload->'codeChallenge',43);
  if challenge !~ '^[A-Za-z0-9_-]{43}$' or payload->>'codeChallengeMethod'<>'S256' then raise exception 'invalid_schema'; end if;
  digest:=workspace_private.agent_hash(payload::text);
  insert into workspace_private.device_requests(request_id,request_digest,display_name,requested_scopes,challenge)
   values(payload->>'requestId',digest,payload->>'displayName',requested,challenge)
   on conflict(request_id) do nothing;
  select * into d from workspace_private.device_requests where request_id=payload->>'requestId' for update;
  if d.request_digest<>digest then raise exception 'idempotency_conflict'; end if;
  if d.expires_at<=now() then raise exception 'expired_token'; end if;
  return jsonb_build_object('requestId',d.id,'expiresAt',d.expires_at,'interval',d.poll_interval);
 end if;
 if action in ('inspect','approve','deny') then
  -- The owner is derived solely from the verified live session.
  w:=workspace_private.owner_workspace();
  perform workspace_private.shape(payload,array['id'],case when action='approve' then array['scopes'] else '{}'::text[] end);
  select * into d from workspace_private.device_requests where id=(payload->>'id')::uuid for update;
  if d.id is null or (d.workspace_id is not null and d.workspace_id<>w) then raise exception 'scope_denied'; end if;
  if d.expires_at<=now() then raise exception 'expired_token'; end if;
  if action='inspect' then return jsonb_build_object('id',d.id,'displayName',d.display_name,'requestedScopes',d.requested_scopes,'status',d.status,'expiresAt',d.expires_at,'identity','self-reported, unverified'); end if;
  if d.status<>'pending' then raise exception 'registration_closed'; end if;
  if action='deny' then
   update workspace_private.device_requests set status='denied',workspace_id=w where id=d.id;
   return jsonb_build_object('status','denied');
  end if;
  chosen:=workspace_private.agent_scopes(payload->'scopes');
  if not chosen <@ d.requested_scopes then raise exception 'scope_denied'; end if;
  insert into workspace_private.agent_connections(workspace_id,display_name,requested_scopes,granted_scopes,status,setup_challenge,setup_expires_at)
   values(w,d.display_name,d.requested_scopes,chosen,'approved',d.challenge,d.expires_at) returning id into cid;
  update workspace_private.device_requests set status='approved',workspace_id=w,connection_id=cid where id=d.id;
  return jsonb_build_object('status','approved','connectionId',cid);
 end if;
 if action='poll' then
  perform workspace_private.shape(payload,array['id','codeVerifier']);
  challenge:=workspace_private.txt(payload->'codeVerifier',128);
  if challenge !~ '^[A-Za-z0-9._~-]{43,128}$' then raise exception 'auth_required'; end if;
  -- Lock workspace before request/connection to preserve existing lock order.
  select workspace_id into w from workspace_private.device_requests where id=(payload->>'id')::uuid;
  if w is not null then perform 1 from workspace_private.workspaces where id=w for update; end if;
  select * into d from workspace_private.device_requests where id=(payload->>'id')::uuid for update;
  if d.id is null or workspace_private.agent_hash(challenge)<>d.challenge then raise exception 'auth_required'; end if;
  if w is distinct from d.workspace_id then return jsonb_build_object('error','authorization_pending','interval',5); end if;
  if d.expires_at<=now() then raise exception 'expired_token'; end if;
  if d.status='denied' then return jsonb_build_object('error','access_denied'); end if;
  if d.status='exchanged' then return jsonb_build_object('error','already_exchanged'); end if;
  if d.next_poll>clock_timestamp() then
   update workspace_private.device_requests set poll_interval=least(60,poll_interval+5),next_poll=clock_timestamp()+make_interval(secs=>least(60,poll_interval+5)) where id=d.id returning * into d;
   return jsonb_build_object('error','slow_down','interval',d.poll_interval);
  end if;
  update workspace_private.device_requests set next_poll=clock_timestamp()+make_interval(secs=>poll_interval) where id=d.id;
  if d.status='pending' then return jsonb_build_object('error','authorization_pending','interval',d.poll_interval); end if;
  result:=workspace_private.agent_transport_body('exchange',null,jsonb_build_object('registrationId',d.connection_id,'codeVerifier',challenge));
  update workspace_private.device_requests set status='exchanged' where id=d.id;
  return result;
 end if;
 raise exception 'scope_denied';
end $$;
create function workspace_private.device_rpc(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not coalesce((select enabled from workspace_private.device_activation where singleton),false)
 or not coalesce((select enabled from workspace_private.agent_activation where singleton),false) then return jsonb_build_object('error','connections_disabled'); end if;
 if not workspace_private.agent_budget('device:'||case when action in ('start','poll') then action else 'owner' end,case when action='poll' then 120 else 30 end) then return jsonb_build_object('error','rate_limited'); end if;
 begin return workspace_private.device_body(action,payload);
 exception when others then
  if sqlerrm in ('scope_denied','auth_required','expired_token','registration_closed','idempotency_conflict','invalid_schema') then return jsonb_build_object('error',sqlerrm); end if;
  return jsonb_build_object('error','request_declined');
 end;
end $$;
create function public.workspace_device(action text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select workspace_private.device_rpc(action,payload);
$$;
revoke all on function workspace_private.device_body(text,jsonb),workspace_private.device_rpc(text,jsonb),public.workspace_device(text,jsonb) from public,anon,authenticated;

