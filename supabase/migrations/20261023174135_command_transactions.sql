-- Additive owner-scoped command ledger. Existing owner_workspace row lock
-- serializes ALL manual/report/command mutations for a workspace.
create table workspace_private.commands (
 workspace_id uuid not null references workspace_private.workspaces(id),
 id text not null, proposal jsonb not null, body jsonb not null,
 committed_at timestamptz not null default now(), primary key(workspace_id,id)
);
alter table workspace_private.commands enable row level security;
alter table workspace_private.commands force row level security;
create policy owner_read on workspace_private.commands for select to authenticated
 using ((select workspace_private.session_active()) and workspace_id in
 (select id from workspace_private.workspaces where owner_id=(select auth.uid())));
revoke all on workspace_private.commands from public,anon,authenticated;
grant select on workspace_private.commands to authenticated;
create index commands_history on workspace_private.commands(workspace_id,committed_at desc,id);

create function workspace_private.command_apply(proposal jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=workspace_private.owner_workspace(); cid text; op jsonb; old jsonb; rec jsonb;
 prior workspace_private.commands%rowtype; changes jsonb:='[]'; ids text[]:='{}'; rid text; result jsonb;
begin
 if octet_length(proposal::text)>65536 then raise exception 'payload_too_large'; end if;
 perform workspace_private.shape(proposal,array['commandId','timezone','operations']);
 cid:=workspace_private.identifier(proposal->'commandId');
 if proposal->>'timezone' is distinct from 'Asia/Kolkata' or jsonb_typeof(proposal->'operations') is distinct from 'array' then raise exception 'invalid_schema'; end if;
 if jsonb_array_length(proposal->'operations') not between 1 and 10 then raise exception 'invalid_schema'; end if;
 select * into prior from workspace_private.commands c where c.workspace_id=w and c.id=cid;
 if found then
   if prior.proposal<>proposal then raise exception 'idempotency_conflict'; end if;
   return prior.body;
 end if;
 for op in select value from jsonb_array_elements(proposal->'operations') loop
   perform workspace_private.shape(op,array['id','kind','expectedRevision','data']);
   rid:=workspace_private.identifier(op->'id');
   if rid=any(ids) then raise exception 'duplicate_target'; end if; ids:=array_append(ids,rid);
   perform workspace_private.choice(op->'kind',array['task','meeting','note']);
   if op->>'kind'='meeting' and (
     coalesce(op->'data'->>'start','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+-]\d{2}:\d{2})$' or
     coalesce(op->'data'->>'end','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+-]\d{2}:\d{2})$') then raise exception 'explicit_timezone_required'; end if;
   select body into old from workspace_private.records where workspace_id=w and id=rid;
   rec:=workspace_private.mutate(op);
   changes:=changes||jsonb_build_array(jsonb_build_object('before',old,'after',rec));
 end loop;
 result:=jsonb_build_object('commandId',cid,'receiptId',gen_random_uuid(),'digest',encode(sha256(convert_to(proposal::text,'UTF8')),'hex'),
 'committedAt',now(),'timezone','Asia/Kolkata','changes',changes);
 insert into workspace_private.commands values(w,cid,proposal,result,now());return result;
end $$;

create function workspace_private.command_undo(command_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=workspace_private.owner_workspace(); r jsonb; c jsonb; current_record jsonb; restored jsonb; rid text;
begin
 perform workspace_private.identifier(to_jsonb(command_id));
 select body into r from workspace_private.commands where workspace_id=w and id=command_id;
 if r is null then raise exception 'unknown_command'; end if;
 if r ? 'undo' then return r; end if;
 if (r->>'committedAt')::timestamptz < now()-interval '7 days' then raise exception 'undo_expired'; end if;
 for c in select value from jsonb_array_elements(r->'changes') loop
   select body into current_record from workspace_private.records where workspace_id=w and id=c->'after'->>'id';
   if current_record is null or current_record->'revision'<>c->'after'->'revision' then raise exception 'revision_conflict'; end if;
 end loop;
 for c in select value from jsonb_array_elements(r->'changes') loop
   rid:=c->'after'->>'id';
   if c->'before'='null'::jsonb then delete from workspace_private.records where workspace_id=w and id=rid;
   else
     restored:=c->'before'||jsonb_build_object('revision',(c->'after'->>'revision')::bigint+1,'updatedAt',now());
     update workspace_private.records set body=restored where workspace_id=w and id=rid;
     insert into workspace_private.history values(w,rid,(restored->>'revision')::bigint,restored);
   end if;
 end loop;
 r:=r||jsonb_build_object('undo',jsonb_build_object('receiptId',gen_random_uuid(),'committedAt',now()));
 update workspace_private.commands set body=r where workspace_id=w and id=command_id;return r;
end $$;

create function workspace_private.command_receipt(command_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=workspace_private.owner_workspace(); r jsonb;
begin
 perform workspace_private.identifier(to_jsonb(command_id));
 select body into r from workspace_private.commands where workspace_id=w and id=command_id;return r;
end $$;
create function workspace_private.command_history()
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=workspace_private.owner_workspace();
begin
 return coalesce((select jsonb_agg(body order by committed_at desc,id) from
 (select body,committed_at,id from workspace_private.commands where workspace_id=w order by committed_at desc,id limit 100) recent),'[]'::jsonb);
end $$;
create function public.workspace_command_apply(proposal jsonb) returns jsonb language sql security invoker set search_path='' as $$ select workspace_private.command_apply(proposal); $$;
create function public.workspace_command_undo(command_id text) returns jsonb language sql security invoker set search_path='' as $$ select workspace_private.command_undo(command_id); $$;
create function public.workspace_command_receipt(command_id text) returns jsonb language sql security invoker set search_path='' as $$ select workspace_private.command_receipt(command_id); $$;
create function public.workspace_command_history() returns jsonb language sql security invoker set search_path='' as $$ select workspace_private.command_history(); $$;
revoke all on function workspace_private.command_apply(jsonb),workspace_private.command_undo(text),workspace_private.command_receipt(text),workspace_private.command_history(),public.workspace_command_apply(jsonb),public.workspace_command_undo(text),public.workspace_command_receipt(text),public.workspace_command_history() from public,anon,authenticated;
grant execute on function workspace_private.command_apply(jsonb),workspace_private.command_undo(text),workspace_private.command_receipt(text),workspace_private.command_history(),public.workspace_command_apply(jsonb),public.workspace_command_undo(text),public.workspace_command_receipt(text),public.workspace_command_history() to authenticated;
