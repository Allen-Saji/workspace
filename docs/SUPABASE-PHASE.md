# Supabase adaptation — local review phase

This branch implements the Supabase adapter. Following explicit free-only approval,
the parent created the dedicated Mumbai `workspace` project and this task applied
the owner-isolation migration through the Supabase connector. Local configuration
uses only its publishable key in ignored `.env.local`. No Vercel deployment or
personal SQLite migration has occurred. The original main worktree is unchanged.

## Hosted verification checkpoint

The project is ACTIVE_HEALTHY. All four application tables have ENABLE/FORCE RLS;
security and performance advisors returned no findings. Anonymous PostgREST snapshot
calls return 401 / permission denied. The connected local browser correctly requests
sign-in and does not show personal records or fall back to SQLite.

Actual multi-user Auth, PostgREST isolation, concurrent writes and recovery testing
remain pending. Email confirmation is enabled. No test Auth accounts have been
created. An administrative-key enumeration command was rejected by approval review;
the publishable-only connector succeeded instead. Creating confirmed synthetic users
through the official Auth admin API requires a separately approved temporary admin
credential path. Do not disable email verification or manufacture Auth sessions.
The applied remote migration was recorded by the connector; reconcile migration
history before any future CLI migration push rather than reapplying this file blindly.

## Bounded architecture

- `WORKSPACE_STORAGE=sqlite` remains the default. It is restricted to an explicit
  loopback origin and refuses to run as the storage backend on Vercel.
- `WORKSPACE_STORAGE=supabase` requires an exact configured origin, HTTPS Supabase
  URL and a publishable key. Invalid/missing config fails closed; no SQLite fallback.
  No database password, service-role key or secret API key is accepted by this adapter.
- The operation-level `WorkspaceRepository` port bridges synchronous SQLite domain
  transactions and asynchronous Supabase RPCs. Hosted writes never simulate a
  transaction using multiple independent HTTP writes.
- Browser components call same-origin Next route handlers. `@supabase/ssr` manages
  server-only, HttpOnly, SameSite=Lax cookies (Secure on HTTPS); there is no browser
  Supabase client or token-bearing localStorage. All session refreshes happen in
  writable route handlers, so no Server Component/proxy refresh is needed.
- Each protected route calls `auth.getUser()` before storage access. It does not
  trust `getSession()` user objects or user-editable metadata. Host, Origin,
  Fetch-Metadata and mutation-header checks remain active. Responses are private,
  no-store, including errors and refresh responses. Raw auth/DB errors are hidden.
- Sign-in uses an existing account's password. No signup, email sending, recovery,
  OAuth provisioning or account administration is implemented. Sign-out ends the
  current Supabase session. The UI adds session controls and accurate storage labels;
  the illustrated design and existing local workflow remain intact.

## Database authorization and transactions

One explicitly provisioned owner per workspace is supported in this phase. A unique
`owner_id` references `auth.users`; the database derives workspace identity from
`auth.uid()`. RPCs accept no workspace/owner selector. There is no signup trigger,
membership self-grant, workspace-creation endpoint or personal-data seed.

All four tables live in `workspace_private`, with ENABLE/FORCE RLS and owner-specific
SELECT policies. Authenticated users have no direct table write privileges. An active
`auth.sessions` row matching the signed JWT's `session_id` and user is required;
anonymous accounts and deleted sessions are denied, including direct RLS reads.
This detects deleted sessions, not proactive inactivity/time-box expiration before
Supabase deletes the session. Live Auth policy/expiry behavior is a rollout test.

Public RPC wrappers are SECURITY INVOKER. Narrow private SECURITY DEFINER operation
functions intentionally own the write transaction: explicit session/owner checks,
fixed empty search_path, fully qualified names, no dynamic SQL, no caller identity,
and complete input validation. They serialize per workspace via a workspace row lock.
This privileged boundary is deliberate and must be reviewed before applying SQL;
RLS does not constrain a postgres-owned definer function. Only specific operation
functions and the session predicate are executable by authenticated; PUBLIC/anon
execution and helper access are revoked. Keep `workspace_private` out of exposed
PostgREST schemas. No application service-role credential is required.

Reports, captures, history and receipts commit atomically. Replays return the original
receipt/time; changed payloads conflict. Edits use expected revisions. Corrections
preserve provenance and original reports, and never mark remote assistant memory as
synced. Postgres computes SHA-256 over canonical JSONB text; SQLite computes it over
the normalized JS report serialization. Each backend's receipt is stable within that
backend; digests/receipts are not migrated or claimed identical across backends.

The current assistant remains an owner-mediated explicit report relay. Hosted login
does not implement agent credential issuance. Synthetic registration approvals still
grant no operational access. The existing CLI imports into SQLite only; there is no
automatic personal-data transfer to the hosted adapter.

## Verification and limits

Final local review passed all 28 tests, lint, typecheck and production build.
Direct-RPC regression coverage includes oversized revision numbers before bigint
conversion. Browser QA before the pause verified unconfigured sign-in, repeated
attempts, return navigation, cancellation, local task persistence after reload and
the 390px sign-in layout. No real credentials were used for those checks. Final
review also removed misleading saved/local labels while a connection is unverified.

Tests execute the migration in PGlite's in-memory Postgres engine, including actual
roles, grants, RLS, PL/pgSQL and transaction rollback. Synthetic test-only auth tables
and JWT claim settings stand in for Supabase Auth. Adapter tests also cover validation,
configuration, server verification and origin enforcement. These are stronger than
static SQL checks but are NOT live hosted Supabase/PostgREST/Auth validation.

PGlite has one connection: multi-connection lock contention, concurrent token refresh,
network failure after COMMIT, real PostgREST grants/schema exposure, hosted migrations,
Auth rate limits/password recovery, and provider-specific cookie delivery require a
dedicated staging project and live tests before rollout. No hosted success is claimed.

For isolated local UI QA while main runs on 3210, set session-only
`WORKSPACE_ORIGIN=http://127.0.0.1:3211` and start Next bound to 127.0.0.1:3211 from
this worktree. Its `.data` is separate; never copy the original SQLite files here.

## Approval gates for the next phase

1. Confirm a dedicated Supabase project name, owning organization, region and exact
   cost/capacity. Recommend a dedicated `workspace` project; do not reuse unrelated data.
2. Approve creating that project and its authentication configuration. Choose the
   intended application owner account and a reviewed signup/recovery policy.
3. Review/apply this migration to the empty dedicated project. Provision only the
   approved owner's auth UUID/workspace row. Run database advisors and live RLS tests
   with two synthetic accounts, anonymous calls, direct RPC abuse, revocation and races.
4. Approve configuring only the project URL/publishable key and exact allowed origin
   in the intended environment. No secrets belong in the repository or conversation.
5. Separately approve a Vercel project, linking/deployment and Git auto-deploy behavior.
   Confirm account/team and project before any consequential command. Provisioning
   Supabase does not authorize Vercel deployment or public exposure.
6. Keep personal SQLite data in place. Any later import needs a reviewed explicit
   migration plan, backup, mapping and user approval. Start hosted development empty.

## References consulted

- https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs
- https://supabase.com/docs/guides/auth/sessions
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/changelog.md
- https://pglite.dev/docs/

Exact dependency versions and integrity hashes are recorded in package-lock.json.
