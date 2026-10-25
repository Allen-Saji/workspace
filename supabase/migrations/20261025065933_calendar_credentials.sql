-- Ciphertext only. No provider token is available to SQL, browser clients,
-- workspace snapshots or reporting connections. The server holds the AEAD key.
create table workspace_private.calendar_secrets (
  workspace_id uuid not null references workspace_private.workspaces(id),
  slot text not null check (slot in ('tokens','oauth')),
  ciphertext text,
  revision bigint not null check (revision > 0),
  primary key(workspace_id,slot)
);
alter table workspace_private.calendar_secrets enable row level security;
alter table workspace_private.calendar_secrets force row level security;
revoke all on workspace_private.calendar_secrets from public,anon,authenticated;

create function workspace_private.calendar_secret(action text,slot text,ciphertext text default null,expected_revision bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid:=workspace_private.owner_workspace(); current_row workspace_private.calendar_secrets%rowtype;
begin
  if action not in ('get','set') or slot not in ('tokens','oauth') or action is null or slot is null then raise exception 'invalid_schema'; end if;
  select * into current_row from workspace_private.calendar_secrets c where c.workspace_id=w and c.slot=calendar_secret.slot;
  if action='set' then
    if expected_revision is null or expected_revision<0 or expected_revision>=9007199254740991 then raise exception 'invalid_revision'; end if;
    if coalesce(current_row.revision,0)<>expected_revision then raise exception 'calendar_revision_conflict'; end if;
    if ciphertext is not null and (length(ciphertext)>40000 or ciphertext !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') then raise exception 'invalid_schema'; end if;
    insert into workspace_private.calendar_secrets values(w,slot,ciphertext,expected_revision+1)
      on conflict on constraint calendar_secrets_pkey do update set ciphertext=excluded.ciphertext,revision=excluded.revision;
    current_row.ciphertext:=ciphertext;current_row.revision:=expected_revision+1;
  end if;
  return jsonb_build_object('workspaceId',w,'ciphertext',current_row.ciphertext,'revision',coalesce(current_row.revision,0));
end $$;
create function public.workspace_calendar_secret(action text,slot text,ciphertext text default null,expected_revision bigint default 0)
returns jsonb language sql security invoker set search_path='' as $$
  select workspace_private.calendar_secret(action,slot,ciphertext,expected_revision);
$$;
revoke all on function workspace_private.calendar_secret(text,text,text,bigint),public.workspace_calendar_secret(text,text,text,bigint) from public,anon,authenticated;
grant execute on function workspace_private.calendar_secret(text,text,text,bigint),public.workspace_calendar_secret(text,text,text,bigint) to authenticated;
