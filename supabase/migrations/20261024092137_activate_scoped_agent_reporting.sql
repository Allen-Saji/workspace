-- Approved scoped activation. No pairing, registration, token or agent is created.
grant usage on schema workspace_private to anon;
grant execute on function public.workspace_agent_control(jsonb) to authenticated;
grant execute on function public.workspace_agent_transport(text,text,jsonb) to anon;
grant execute on function workspace_private.agent_rpc(text,text,jsonb,boolean) to anon,authenticated;
grant execute on function public.workspace_agent_journal() to authenticated;
grant execute on function workspace_private.agent_journal_snapshot() to authenticated;
grant execute on function public.workspace_agent_journal_transport(text,text,jsonb) to anon;
grant execute on function workspace_private.agent_journal_rpc(text,text,jsonb) to anon;
update workspace_private.agent_activation set enabled=true where singleton;
-- Non-destructive emergency stop: set enabled=false, then revoke these EXECUTE grants.
-- Keep schemas, histories, owner data and token hashes intact during investigation.
