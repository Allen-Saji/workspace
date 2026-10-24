> Status update 2026-10-24: reviewed migrations and local app activation are now applied. See [HOSTED-ACTIVATION.md](HOSTED-ACTIVATION.md) for actual live checks and limits. Pending/unapplied statements below describe the original implementation checkpoint.

# Hosted agent connections: implementation and activation boundary

This code is implemented locally, not activated on Supabase. It adds no real agent
credentials or access. The existing owner-mediated relay remains separate.

## Authorization and persistence

The two unapplied candidates are `20261023172249_connection_persistence_candidate.sql`
and `20261024082058_hosted_connection_transactions_candidate.sql`. The second uses
standard pgcrypto random bytes and SHA-256, not custom encryption. Only hashes persist.
Owner control requires a confirmed, nonanonymous, still-active ordinary Auth session;
workspace ownership comes from the relational row. No caller selects an owner/workspace.

The hosted adapter calls two narrow RPCs with a publishable key. Owner control carries
verified SSR Auth; agent transport uses a sessionless client and an opaque token as a
function argument, never as a Supabase JWT. The private SECURITY DEFINER boundary is
intentional: an agent is a limited connection identity, not an Auth user. It derives
workspace and capabilities from the token row before any operation. It cannot read
context, edit tasks, grant additional scopes, or inspect another connection's receipts.
Public wrappers are invoker functions. Every new function has default grants revoked.
The database switch is false and the application review constant is false. Environment
variables alone cannot enable issuance.

Pairing codes expire after ten minutes. Atomic registration binds a code to one
request digest and S256 challenge. Exact retries return the same registration; changed
payloads reject. Owner approval narrows scopes; no credential is issued until proof
exchange. Exchange is one-time, with a one-hour token. Rotation replaces the sole token
hash and advances generation. Lost exchange/rotation response requires owner revoke
and a new pairing: raw credentials are deliberately not recoverable from storage.

Workspace row locks precede connection locks in all write/authorization paths. Report
validation, authorization, capture writes and receipt commit happen in one transaction.
Revocation blocks subsequent reports including retries and receipt reads. Earlier
committed reports remain historical. Original reports remain unchanged; capture IDs
are namespaced by connection, and relay event IDs cannot collide with agent report
keys. Digest covers canonical original JSONB. Receipts identify normalized capture IDs.
Acceptance, saved-here and remote-acknowledgment remain independent.

Database rate buckets apply across app instances; an outer RPC commits attempts while
an inner subtransaction rolls back failed operations. Transport uses five fixed global
buckets (30 setup/exchange/rotation or 120 event/receipt attempts per minute). This is
conservative and can deny other clients during abuse. It is not a general internet-scale
abuse solution. Edge/IP protection and bounded retention must be reviewed before public
activation. Raw parameters must not be logged by any future reverse proxy or tracing.
The one-time secret response must never be cached, logged or included in screenshots.

## Verification and limits

Embedded PGlite executes actual migrations, forced RLS, grants, functions and pgcrypto
with synthetic Auth claims. Tests cover isolated owners, no default RPC access, disabled
activation, scoped approval, one-use proof, payload conflict, atomic rollback, namespaces,
close/reopen persistence, rotation, revocation, expiration and failed-request budgets.
Queued calls in PGlite verify one-winner results, not independent hosted lock contention.
Existing SQLite worker tests exercise separate-process pairing. No live hosted agent
functions or credentials were used. Live cross-user and independent PostgREST contention
remain pending ordinary-user sessions plus approved activation. No admin key is needed.

## Bundled activation review, still pending

1. Review and approve applying these exact two candidates to the dedicated free project,
   including pgcrypto in `extensions`. Inspect conflicting schema and run advisors first.
2. Review the public RPC surface, narrow grants and database activation. Control is for
   authenticated owners; transport is capability-authenticated and would be callable by
   anon through a publishable-key client. The private dispatcher independently checks
   its owner-control branch. Do not grant access to other private helpers or tables.
3. Approve the application review constant and `WORKSPACE_CONNECTIONS=hosted` only after
   live ordinary-user isolation, rate-limit, rotation/revocation and concurrency checks.
   Check TLS, secret-response/log handling, abuse/retention policy and rollback controls.
4. Separately approve the exact external agent, scopes and one-time secure delivery before
   issuing any real connection. No blanket credential or external-communication grant.

No push, deployment, paid service, personal-data migration or real key issuance is part
of the current implementation milestone. Do not run blanket `supabase db push`.

Sources checked 2026-10-24: Supabase changelog (CBC TLS retirement affects legacy clients,
not Node 24 TLS 1.3), database functions and securing-your-API docs; installed Next route
handler docs. See https://supabase.com/docs/guides/database/functions and
https://supabase.com/docs/guides/api/securing-your-api .

Milestone verification: full suite 63/63, lint, TypeScript and isolated production build passed.
Edge UI checks used synthetic in-memory credentials at actual 1440px and 390px viewport
widths, with no horizontal overflow. Review/cancel, reload/back, duplicate receipt and
revoke-denial checks passed. This does not claim live hosted agent validation.
