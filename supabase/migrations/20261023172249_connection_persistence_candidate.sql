-- UNAPPLIED CANDIDATE. Tables only; no credential issuance RPC is activated.
-- A reviewed hosted transaction adapter must land before this schema is used.
create table workspace_private.agent_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspace_private.workspaces(id),
  display_name text not null check(length(display_name) between 1 and 100),
  requested_scopes text[] not null check(requested_scopes <@ array['reports:append','captures:append','receipts:read'] and 'reports:append'=any(requested_scopes)),
  granted_scopes text[] not null default '{}' check(granted_scopes <@ requested_scopes),
  status text not null check(status in ('pending','approved','active','rejected','revoked')),
  setup_challenge text not null check(setup_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  setup_expires_at timestamptz not null,
  token_expires_at timestamptz,
  generation bigint not null default 0 check(generation>=0),
  created_at timestamptz not null default now(),
  check(status not in ('approved','active') or 'reports:append'=any(granted_scopes)),
  check(status<>'active' or token_expires_at is not null)
);
create index agent_connections_workspace on workspace_private.agent_connections(workspace_id);
create table workspace_private.agent_pairings (
  code_hash text primary key check(code_hash ~ '^[A-Za-z0-9_-]{43}$'),
  workspace_id uuid not null references workspace_private.workspaces(id),
  expires_at timestamptz not null,
  request_id text,
  request_digest text,
  connection_id uuid unique references workspace_private.agent_connections(id),
  check((request_id is null and request_digest is null and connection_id is null)
    or (request_id is not null and request_digest is not null and connection_id is not null))
);
create index agent_pairings_workspace on workspace_private.agent_pairings(workspace_id);
create table workspace_private.agent_token_hashes (
  token_hash text primary key check(token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  connection_id uuid not null unique references workspace_private.agent_connections(id),
  generation bigint not null check(generation>0),
  expires_at timestamptz not null
);
alter table workspace_private.agent_connections enable row level security;
alter table workspace_private.agent_connections force row level security;
alter table workspace_private.agent_pairings enable row level security;
alter table workspace_private.agent_pairings force row level security;
alter table workspace_private.agent_token_hashes enable row level security;
alter table workspace_private.agent_token_hashes force row level security;
revoke all on workspace_private.agent_connections,workspace_private.agent_pairings,workspace_private.agent_token_hashes from public,anon,authenticated;
-- Only non-secret connection metadata is readable. Setup/token hashes remain private.
grant select(id,workspace_id,display_name,requested_scopes,granted_scopes,status,setup_expires_at,token_expires_at,generation,created_at)
  on workspace_private.agent_connections to authenticated;
create policy owner_connections on workspace_private.agent_connections for select to authenticated
  using ((select workspace_private.session_active()) and workspace_id in
    (select id from workspace_private.workspaces where owner_id=(select auth.uid())));
-- No direct write grants, issuance functions or public schema wrappers in this candidate.
