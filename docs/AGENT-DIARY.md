# Agent diary/status v2 readiness

Public skill: `/skills/workspace-reporting/SKILL.md`, with a portable HTTP contract in
its references/contract.md. These static files contain no credentials or personal work.
This is a reporting skill, not an autonomous scheduler, agent host or external messaging
integration. The UI's Sync now instructions prepare a user/host instruction only.

v1 is unchanged. v2 adds /api/agent/v2/{diary,status,receipts,journal}; only journal GET
is owner-readable. Other routes use scoped agent tokens and reject cookie auth/query
parameters. It reuses reports:append and receipts:read. No captures or context reads
are added. The ephemeral harness accepts synthetic test reports only. No persistent
real credentials, hosted writes or jobs were created by this phase.

The separately unapplied `20261024084829_agent_diary_v2_candidate.sql` depends on the
two prior connection candidates. It adds private forced-RLS tables and narrowly checked
transaction functions, with all client grants revoked. It uses the existing database
activation switch but additionally requires HOSTED_JOURNAL_REVIEWED=false to be reviewed
and changed before hosted v2 application access. Do not activate it by enabling v1 only.
A future activation review must explicitly include v2 public owner-read and transport
RPCs and their private dispatchers; no generic table/helper permissions are needed.

Each approved connection is the current authenticated agent identity. Unique diary
key: workspace/connection/localDate. Re-pairing creates a new identity; continuity or
merging across connections is not implemented. Self-reported names never merge access
or histories. This is an explicit limit to resolve before claiming a permanent logical
agent identity across re-pairing.

A diary uses expectedRevision, an immutable event receipt and preserved revision event
history. Exact retries return their original receipt, even after later revisions; stale
new updates fail without partial writes. Backfills validate observedAt against the
claimed localDate in its IANA timezone. A date's timezone cannot change after creation.
Status is a separate stream: latest observedAt, then sentAt, then eventId determines
current reported state. A delayed offline event cannot overwrite a newer observation.
The server supplies receivedAt. All outcomes/evidence remain agent-reported.

Defaults are drafts: browser's actual IANA timezone, 18:00 local end of day, 3-hour
active status interval. The user can edit these; they persist only in that browser and
must be applied in the external host. There is no assumed UTC day or live scheduling.
Staleness threshold is cadence + one-hour grace; silence never means offline. Host DST
policy: once per calendar day, first repeated occurrence, next valid time if skipped.
Offline catch-up runs only at the next authorized host wake. Do not invent missing work.

The one-hour credential TTL remains unchanged. Host-managed rotation must happen before
expiry independently of the 3-hour status cadence; otherwise re-pair. A longer lifetime,
refresh mechanism or durable logical identity requires a separate security design review.

Verification uses isolated SQLite, embedded PGlite with synthetic Auth and isolated Edge
contexts. Live v2 PostgREST/RLS tests remain pending activation and ordinary-user sessions.
Skill frontmatter, relative reference paths and both JSON examples are checked by Node
tests. The bundled Python quick_validate.py could not run because no runnable Python
interpreter was available; no claim of official skill-validator success is made.

Final verification: 68 tests passed; lint, typecheck and normal/isolated production
builds passed. Isolated desktop (1440px) and mobile (390px) Edge checks passed diary
revision/replay, delayed status ordering, preference reload, manual-sync instructions,
cancel/back and revocation. Public skill HTTP route returned 200. Synthetic screenshots
were inspected. No hosted migration was applied and no live v2 validation is claimed.
