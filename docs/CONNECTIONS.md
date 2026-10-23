# Connection authorization: isolated test implementation

Production issuance is disabled. This implementation replaces the visible status-only
registration rehearsal with a disabled-by-default integration harness that actually
checks credentials, scopes, expiry and revocation. It does not connect an external
agent, grant access to personal records or implement a hosted credential service.

## Boundary and protocol

Only `WORKSPACE_CONNECTIONS=ephemeral-test` with loopback SQLite mode enables the
test endpoints. Vercel and Supabase modes refuse this harness. State is in a separate
in-memory SQLite database; the HTTP harness accepts no file path. Restart invalidates all test
grants and removes test reports. Its receipts prove an in-memory transaction only,
not durable personal-workspace persistence. The existing explicit relay remains
unchanged and has its own durable storage and receipt path.

One route family, `/api/agent/v1/[path]`, owns the single-process test state:

- GET `capabilities`: reports enabled/test-only state; never claims production ready.
- GET/POST `control`: local owner lists requests, creates pairing codes, approves
  narrowed scopes, rejects or revokes. Strict origin/host/custom-header checks.
- POST `registrations`: pairingCode, requestId, displayName, requestedScopes,
  codeChallenge, codeChallengeMethod=`S256`. No caller owner/workspace selector.
- POST `exchange`: registrationId and codeVerifier. Pending returns no credential.
- POST `events`: JSON report, authenticated with `Authorization: Bearer ...`.
- POST `receipts`: eventId, same bearer authentication; only own connection receipts.
- POST `rotate`: empty JSON body and current bearer; returns a replacement once,
  atomically invalidating the previous token. Lost response requires revoke/re-pair.

Agent endpoints reject cookies and query strings. Transport is loopback HTTP only
for this test harness; production must use approved HTTPS and verified owner sessions.
The local OS account is the owner trust boundary here, not production authentication.

Codes and tokens use Node crypto.randomBytes(32); only SHA-256 hashes are stored.
Pairing expires in ten minutes and is atomically redeemed once. Exact registration
retry recovers its result; altered reuse rejects. PKCE S256 uses the RFC 7636 verifier
syntax and challenge algorithm with constant-time challenge comparison. No custom
encryption/signature algorithm is implemented. This is an application protocol using
PKCE primitives, **not a complete OAuth authorization server or certified profile**.
The self-reported agent name remains unverified.

Owner approval allows only requested reports:append, captures:append, receipts:read;
reports:append is required. Approval alone returns no bearer token. Successful proof
exchanges once for a one-hour token. Raw tokens are never saved for replay. If that
response is lost, revoke and re-pair; do not claim recoverable credential delivery.
Revocation deletes token hashes and closes pending/approved requests. Authentication,
scope checks and report writes share a BEGIN IMMEDIATE transaction, so revocation
cannot race between authorization and commit. A previously committed report remains
historical; the revoked token cannot submit duplicates or read receipts.

Only isTest=true reports are accepted. Entity references are refused to prevent
append-only clients probing personal IDs. Capture IDs are deterministically namespaced
by connection before validation/storage/digest; receipt IDs identify the normalized
records. Global per-minute budgets cover setup, exchange, events and receipt lookup;
failed attempts consume budget too. This is deliberately conservative and can deny
other test clients under load. Production needs distributed per-principal/IP controls,
payload retention limits and operational auditing without secrets.

## Durable adapter readiness

`SqliteConnections(path)` implements durable registration, token-hash storage, expiry,
rotation and receipt transactions with SQLite WAL/FULL synchronization. It shares the
existing storage adapter and transaction primitive; it is not wired to a live HTTP
file path. The default `TestConnections` subclass still uses only `:memory:`.
All connection variants currently accept synthetic reports only. Tests create fresh
temporary databases, close/reopen them, race independent worker connections, and
verify that raw codes, verifiers and bearer tokens are absent from the database file.
Rotation and revocation invalidate old tokens before a subsequent ingestion can commit.
An already completed write remains recorded; revocation is not retroactive deletion.

The unapplied `connection_persistence_candidate` migration adds private Postgres
connection/pairing/token-hash tables with owner-readable metadata, forced RLS and no
client write permissions. Token hashes and setup challenges are not client-readable.
Its grants and owner isolation are tested in embedded Postgres. It deliberately adds
no issuance RPC or hosted activation. Do not apply it until the hosted transaction
adapter and current Auth validation are ready.

Verification: 37 tests, lint, typecheck and production build pass. The durable tests
exercise close/reopen recovery, independent-worker redemption races, cross-owner denial,
expiry, rotation invalidating the old token, revocation surviving restart and absence
of raw secrets from the closed SQLite file. Desktop/mobile UI checks confirm that
implementation readiness does not imply activation. No real-agent credentials exist.

## Remaining production work

Hosted transactional connection operations, real owner session binding,
reviewed delivery/profile compatibility, rotation/recovery, transport-level adversarial
tests, distributed rate limits and an approved external-agent integration remain.
Do not turn on real issuance by renaming a flag. No real persistent credentials were
issued in this phase. Existing synthetic registration records remain as history but
are no longer presented as operational connection controls.

References: https://www.rfc-editor.org/rfc/rfc7636 and https://nodejs.org/api/crypto.html
