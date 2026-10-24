grant usage on schema workspace_private to anon,authenticated;
grant execute on function workspace_private.device_rpc(text,jsonb),public.workspace_device(text,jsonb) to anon,authenticated;
update workspace_private.device_activation set enabled=true where singleton=true;
