-- Explicitly enabled owners only. No client can enable billing or clear usage.
create table workspace_private.assistant_access (
 workspace_id uuid primary key references workspace_private.workspaces(id), enabled boolean not null default false
);
create table workspace_private.assistant_requests (
 workspace_id uuid not null references workspace_private.workspaces(id), request_id text not null,
 digest text not null, day date not null default (now() at time zone 'UTC')::date,
 reserved_micro bigint not null default 50000 check(reserved_micro=50000),
 payload text, created_at timestamptz not null default now(), primary key(workspace_id,request_id)
);
alter table workspace_private.assistant_access enable row level security;
alter table workspace_private.assistant_access force row level security;
alter table workspace_private.assistant_requests enable row level security;
alter table workspace_private.assistant_requests force row level security;
revoke all on workspace_private.assistant_access,workspace_private.assistant_requests from public,anon,authenticated;

create function workspace_private.assistant_budget(request_id text default null, digest text default null, payload text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=workspace_private.owner_workspace(); r workspace_private.assistant_requests%rowtype;
 used bigint; enabled boolean;
begin
 select a.enabled into enabled from workspace_private.assistant_access a where a.workspace_id=w;
 if enabled is distinct from true then raise exception 'assistant_not_enabled'; end if;
 -- Serialize reservations across every enabled owner: $1 total per UTC day for this app.
 perform pg_advisory_xact_lock(727251066);
 select coalesce(sum(a.reserved_micro),0) into used from workspace_private.assistant_requests a where a.day=(now() at time zone 'UTC')::date;
 if request_id is null then return jsonb_build_object('usedUsd',used/1000000.0,'limitUsd',1); end if;
 perform workspace_private.identifier(to_jsonb(request_id));
 if digest is null or digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid_schema'; end if;
 select * into r from workspace_private.assistant_requests a where a.workspace_id=w and a.request_id=assistant_budget.request_id;
 if found then
   if r.digest<>digest then raise exception 'idempotency_conflict'; end if;
   if payload is not null then
     if octet_length(payload)>96000 then raise exception 'payload_too_large'; end if;
     update workspace_private.assistant_requests a set payload=assistant_budget.payload where a.workspace_id=w and a.request_id=assistant_budget.request_id;
     return jsonb_build_object('fresh',false,'payload',payload);
   end if;
   return jsonb_build_object('fresh',false,'payload',r.payload);
 end if;
 if payload is not null then raise exception 'unknown_request'; end if;
 if used+50000>1000000 then raise exception 'assistant_budget_exhausted'; end if;
 insert into workspace_private.assistant_requests(workspace_id,request_id,digest) values(w,request_id,digest);
 return jsonb_build_object('fresh',true,'payload',null);
end $$;
create function public.workspace_assistant_budget(request_id text default null, digest text default null, payload text default null)
returns jsonb language sql security invoker set search_path='' as $$ select workspace_private.assistant_budget(request_id,digest,payload); $$;
revoke all on function workspace_private.assistant_budget(text,text,text), public.workspace_assistant_budget(text,text,text) from public,anon;
grant execute on function workspace_private.assistant_budget(text,text,text), public.workspace_assistant_budget(text,text,text) to authenticated;
