# Agent-initiated device approval candidate

Status: local candidate only. Legacy hosted connections are preserved. No migration,
grants or real credential issued by this work. Existing manual QA client session no
longer exists; no registration was observed before replacement work.

20261024150645_device_authorization_candidate.sql adds forced-RLS private request
and activation tables. No table access or function execution is granted. The public
invoker wrapper calls a private security-definer dispatcher; owner actions require
owner_workspace(), which verifies a confirmed nonanonymous live session.

Start accepts no owner ID. A random public request URL identifies an unowned request;
viewing it neither claims nor approves it. Explicit approval atomically binds the
request to the authenticated owner's workspace and creates an approved legacy
connection with narrowed scopes. Subsequent cross-owner inspect/decide is denied.
A different signed-in user possessing an unclaimed link can approve it only into
their own workspace, never the intended user's workspace. This is why the screen
warns against unexpected links and labels identity as self-reported.

Poll requires S256 proof. It persists increasing backoff even on slow_down, checks
expiry and denial, and exchanges once using the existing token-hash-only mechanism.
No raw verifier or access token enters request tables. Existing revocation blocks
ingestion/receipts. Lost exchange response requires owner revoke, not token recovery.
Global persistent limits are 30 starts/owner actions and 120 polls per minute;
this intentionally conservative limit is not production edge abuse protection.
Request retention and per-IP controls need review before public deployment.

The /connect page is noindex, renders untrusted identity as text, requires a separate
explicit approve/deny click, and accepts no secrets. The app API gate is false.
The approval URL uses a fragment to avoid putting request IDs in request/referrer logs.
Signing in may require returning to the original approval link.

## Activation requiring separate approval
1. Review/apply only this additive migration after checking current schema.
2. Grant only usage of private schema plus EXECUTE on device_rpc and public wrapper
   to anon/authenticated; never grant device_body or table access.
3. Enable device_activation and reviewed app gate together after security review.
4. Test one expressly approved temporary connection through the real owner session.
No automatic credential issuance follows migration alone.
Disable by turning device_activation off and app gate false. Existing credentials
remain independently revocable through legacy controls; disabling onboarding does
not silently revoke unrelated connections.

Embedded checks cover no default grants, disabled activation, replay conflict, wrong
proof, pending/backoff, owner approval, scope narrowing, cross-owner denial, one-use
exchange, denial, expiry and revocation. They do not establish live PostgREST
contention or multi-browser user isolation.
Reference: https://www.rfc-editor.org/rfc/rfc8628

Final local verification: 78 tests passed; lint, typecheck and production build passed.
Desktop and 390x844 browser checks verified disabled setup, invalid link, and readable
layout. Approved/denied browser states were not exercised against hosted credentials.
Embedded concurrent queued exchange calls produce exactly one credential; independent
live PostgreSQL transaction contention remains untested. No live grant or migration.

## Hosted activation and live QA — 2026-10-24

The user approved this exact activation and one temporary Workspace QA connection.
Both candidate and narrow activation migrations succeeded. App gate is now enabled.
Verified anon wrapper access, no anon internal-body access, no anon table SELECT and
no authenticated direct table UPDATE. Advisors reported nine intentional deny-by-default
tables and the pre-existing leaked-password-protection warning; no policies were weakened.

One real device request was approved through the existing owner browser session.
Its scopes were exactly reports:append and receipts:read. The memory-only local client
exchanged once, submitted a synthetic status and diary, recovered both receipts, and
received duplicate receipts on identical replay. The diary revision advanced from 1 to 2.
The UI rendered the synthetic status and revised diary. Cancel/reload before approval
preserved pending state. No personal records were used by the client.

The client exited at its stdin wait (unsettled top-level await), losing its ephemeral
token before post-revocation transport probes. Therefore LIVE OLD-TOKEN DENIAL IS NOT
CLAIMED. Owner UI revocation succeeded; independent SQL verified status revoked, zero
token hashes and three retained journal events. No replacement token/request was created.
The previous manual client and device client are both no longer running.

78 tests, lint, typecheck and production build passed after app activation. Embedded
revocation denial remains covered. Live multi-user isolation, independent concurrency,
and old-token denial still require a separately approved future test. Future QA clients
must keep a live event-loop handle while awaiting revocation, without persisting secrets.
No OpenAI calls, paid changes, push or deployment.
