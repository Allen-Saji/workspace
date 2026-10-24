# Workspace reporting contract v2

No credentials are embedded here. All paths are relative to the explicitly approved
app origin. Check deployment-specific activation; HTTP 503 connections_disabled means stop.
Existing v1 report imports and receipts are unchanged. Do not send v2 to v1/events.

## Host configuration

Required: app origin, secure connection/token reference, approved project scope,
IANA timezone, chosen end-of-day HH:mm, host scheduler/lifecycle hooks and durable
outbox/last diary revision per date. Suggested draft: status interval 3 hours during
active work; choose an end-of-day time with the user (UI draft starts at 18:00 local).
No UTC timezone is silently substituted. DST: use the calendar date in that timezone;
run once on a repeated local time, and at the next available time for a skipped local
time. These are host requirements, not an installed Workspace job.

## Onboarding and transport

GET /api/agent/v1/capabilities first. Require journalEnabled=true and reportVersions containing "2" before v2 reporting. Owner signs in and creates one ten-minute pairing
code in the UI. Agent generates an RFC 7636 verifier and S256 challenge locally, then
POSTs /api/agent/v1/registrations with pairingCode, requestId, displayName,
requestedScopes, codeChallenge and codeChallengeMethod S256. Request reports:append
and receipts:read; captures:append is unnecessary for diary/status. Owner reviews the
self-reported identity and approves a subset. POST /api/agent/v1/exchange with
registrationId and codeVerifier; pending requests must wait at least nextPollSeconds.
An active result returns connectionId, accessToken, expiresAt and grantedScopes once.
No token exists before approval plus successful proof. Lost delivery needs revoke/re-pair.

Use Authorization: Bearer <secure token>, Content-Type: application/json, no cookies
and no URL query parameters. POST /api/agent/v1/rotate with {} before expiry replaces
the token once and invalidates the old one. Do not log request headers or responses.
Expired/revoked tokens fail; rotation is not a general refresh token and cannot revive
expired access. Host rotation needs its own lifecycle support before the one-hour TTL.

## Payloads

POST /api/agent/v2/diary:

```json
{
  "schemaVersion": "2", "kind": "diary", "eventId": "stable-outbox-event-id",
  "observedAt": "2026-10-24T12:00:00.000Z", "sentAt": "2026-10-24T12:01:00.000Z",
  "isTest": true, "summary": "SYNTHETIC example: completed the approved UI review.",
  "evidence": [{"label": "Example result", "url": "https://example.com/result"}],
  "localDate": "2026-10-24", "timezone": "Asia/Kolkata", "expectedRevision": 0,
  "results": ["Reviewed the example flow"], "blockers": [], "nextSteps": ["Review feedback"]
}
```

Dates and text above are examples, not actual work. Use real observation times and
isTest=false only for genuinely approved activity after activation. localDate must
match observedAt in timezone. sentAt must be no earlier than observedAt; neither can
be more than five minutes in the future. Backfills may have old observedAt and current
sentAt. Retrying an outbox event must retain both original timestamps.

expectedRevision=0 creates the day. A later update uses a NEW eventId and the previous
receipt's revision. The unique key is connection + localDate, not timezone or eventId. A connection is the current authenticated agent identity. Re-pairing creates a new identity; automatic history merging across re-pairing is not implemented. Never merge by self-reported display name. Owner-mediated identity continuity is a future extension.
Changing the timezone of an existing date is rejected. Old receipts/revisions remain
historical; a retry of revision 1 does not overwrite a later revision 2.

POST /api/agent/v2/status:

```json
{
  "schemaVersion": "2", "kind": "status", "eventId": "stable-status-event-id",
  "observedAt": "2026-10-24T12:00:00.000Z", "sentAt": "2026-10-24T12:01:00.000Z",
  "isTest": true, "summary": "SYNTHETIC example: starting the approved UI review.",
  "evidence": [], "state": "working"
}
```

state is working, completed, blocked or offline. Status events never create diaries.
The newest observation wins; late delivery does not overwrite newer observed status.
The UI labels status stale after the chosen cadence plus one hour of grace. It never
infers offline from silence. All statuses and diary contents are agent-reported.

Boundaries: 32KiB payload; summary 2000 characters; at most 20 strings of 1000 characters
per results/blockers/nextSteps; at most 10 evidence links (label 200, URL 1000 characters).
No additional fields. HTTPS evidence URLs only; no query, fragment, userinfo or whitespace.

## Receipts and recovery

Successful v2 writes return eventId, receiptId, payloadDigest, receivedAt (server time),
connectionId, kind and status saved/duplicate. Diary receipts also return localDate and
revision. GETs do not accept tokens in URLs. POST /api/agent/v2/receipts with
{"eventId":"the-original-id"} uses receipts:read and returns {receipt:...} or {receipt:null}.
It can read only this connection's v2 receipt. It cannot read diary bodies or other agents.

Exact repeat: same receipt and duplicate status. Altered payload with same eventId:
idempotency_conflict. New update with stale expectedRevision: revision_conflict, no
partial write. Recover the receipt before making another event. If the host lost the
latest revision, ask the owner to inspect the diary; do not guess or force an overwrite.
HTTP 401: stop/repair authorized connection. HTTP 429: obey Retry-After. Unknown network
outcome: retain outbox and recover receipt. Other validation errors: fix only with a new
reviewed event when the previous event is confirmed uncommitted.

## Manual sync instruction

“Use workspace-reporting for this approved project. Send current status and create or
revise the single diary for the relevant local date using configured timezone. Preserve
backfill observation times and recover receipts before retrying. Share only approved
outcomes and evidence; no credentials or internal reasoning.”

Sending this instruction is the user's/host's action. Workspace does not communicate
with or force an arbitrary agent to run. Loading the skill grants no external access.


