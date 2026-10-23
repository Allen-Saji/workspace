-- CANDIDATE ONLY: not applied. No Auth users, credentials or memberships seeded.
-- No arguments: both identity and confirmation come from authoritative Auth.
create function workspace_private.ensure_own_workspace()
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); w uuid;
begin
 if not workspace_private.session_active() then raise exception 'auth_required'; end if;
 if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then
   raise exception 'email_confirmation_required';
 end if;
 -- Unique owner_id enforces one workspace per user. Concurrent first requests
 -- converge on the same row; no supplied owner/id/role or membership table exists.
 insert into workspace_private.workspaces(owner_id) values(uid)
 on conflict(owner_id) do update set owner_id=excluded.owner_id
 returning id into w;
 return jsonb_build_object('workspaceId',w);
end $$;
create function public.workspace_ensure_own()
returns jsonb language sql security invoker set search_path='' as $$
 select workspace_private.ensure_own_workspace();
$$;
revoke all on function workspace_private.ensure_own_workspace(),public.workspace_ensure_own() from public,anon,authenticated;
grant execute on function workspace_private.ensure_own_workspace(),public.workspace_ensure_own() to authenticated;
