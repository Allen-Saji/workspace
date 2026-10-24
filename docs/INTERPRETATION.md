# Interpretation boundary — 2026-10-24

Implemented, not live AI. `/api/interpret` authenticates hosted users and enforces
same-origin/custom-header intent before interpreting. No provider is wired, no env key
is read, and no external model request can occur through this route. GET reports
aiAvailable=false. No SDK or other dependency was added.

The server-only provider interface accepts only the explicit draft, Asia/Kolkata review
timezone and fixed contract instructions plus AbortSignal. It receives no records,
history, tool executor, storage handle, keys or user-selected endpoint. A provider must
return bounded JSON: either clarification text or at most ten create-only task/note/
meeting proposals. Unknown fields/actions, caller IDs, revisions, tool calls, missing
offsets and invalid calendar times are rejected. Text is untrusted and rendered as text.
Schema validity cannot prove semantic correctness; the user must review every detail.

Input is limited to 12,000 characters within the existing 64KiB HTTP body limit. Output
is limited to 32KiB; provider execution has an eight-second abort/deadline. Future
network adapters must also cap streamed bytes before materializing strings and enforce
provider max-output tokens. Timeout, failure and malformed data yield an unavailable
result without details that could leak credentials. There is no retry or paid fallback.

The documented-format parser is an explicit non-AI mode. Ambiguous/destructive free
text asks for clarification. Provider failures never silently switch interpretation.
The UI currently offers only documented formats and labels flexible AI setup needed.
Review requests are synchronously deduplicated. Request identity deterministically
sets proposal/record IDs; replay preserves identity, while altered content with the
same command ID remains protected by the existing apply receipt's digest conflict.
No proposal automatically applies. Editable review, exact target selection, apply,
receipt recovery, atomic mutations and revision-aware undo remain separate.

Timezone scope is deliberately unchanged: Asia/Kolkata command review and explicit
meeting offsets. Arbitrary-zone commands/relative dates require a future schema and UX
change; the diary's configurable timezone does not silently change command semantics.

## Verification

72 tests pass, covering clarification, injected/destructive shapes, strict action/data
allowlists, output bounds, provider failure/timeout/malformed data, retry identity,
HTTP CSRF and caller-selected provider rejection. Existing command tests cover duplicate
apply, revisions and atomic rollback. Lint/typecheck/production build pass. Signed-in
browser review tested unsupported deletion text, a synthetic editable create proposal,
back/repeated review with the same command ID, and mobile 390x844 layout. The synthetic
draft was cleared; Apply was never clicked. No personal records were changed.

## Remaining free-inference decision

Groq Free with openai/gpt-oss-20b is a candidate, not configured or selected for live use.
Official [structured outputs](https://console.groq.com/docs/structured-outputs) document
strict JSON schema support for this model. A future adapter should use required fields
and additionalProperties:false, then retain this application's validation. Consult the
[current free limits](https://console.groq.com/docs/rate-limits) for the actual account;
limits are not an unlimited-service guarantee. HTTP 429 must return manual-entry advice,
not a paid fallback or automatic retry loop.

Before activation: explicit approval to transmit only submitted command text to Groq;
verify free plan/no billing or paid fallback; securely provision a server-only key;
review and configure [data controls](https://console.groq.com/docs/your-data), including
Zero Data Retention. Documentation allows reliability/abuse retention up to 30 days
unless ZDR is enabled. No such configuration or credential action has happened.
Implement per-user throttling, bounded network output/tokens, cancellation, no prompt
logging and realistic synthetic evaluation before opening live AI. Current fake-provider
unit fixtures do not establish model quality, privacy settings or account eligibility.

Deployment remains pending: approved publication/target, server-only environment setup,
verified public origin/callbacks, real-user isolation and abuse limits. Existing agent
credential and external-host approval boundaries remain unchanged. No push/deploy here.
