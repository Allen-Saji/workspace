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

## OpenAI selection and remaining activation decision

The user selected OpenAI; Groq is no longer the planned provider. Official documentation
checked 2026-10-24 lists [gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
with Responses and Structured Outputs support. This is a verified public API ID, not an
inference from Codex aliases. The phrase "GPT Luna" alone does not distinguish all Luna
generations; no model is configured in the app. Account access has not been queried.

Published standard text pricing is $0.10 input and $0.50 output per million tokens on
the model page. API use is not established as free. The user's original free-only constraint
now has an approved US total synthetic test-round exception (see OPENAI-TEST-BUDGET.md); leave
live inference off. No account credit, subscription entitlement or quota is assumed.

`src/server/openai-interpretation.ts` prepares the Responses request contract without
an SDK or dependency: configurable required model ID; strict text.format JSON schema;
all fields required/additionalProperties:false; store:false; no tools, conversation
history or previous response ID; 2,048 output-token cap; 64KiB streamed response bound.
The existing interpreter supplies abort/deadline and validates translated actions.
Refusal/incomplete output, invalid envelope, HTTP errors/429 and overlarge responses
fail closed, with no retry or fallback. Mock transport tests are explicitly synthetic.
There is NO default network transport, key/env lookup or route wiring. The factory is
disabled by default; the actual application continues to report aiAvailable=false.

Before enabling: confirm exact API model and account access, settle cost/budget and
explicit command-text transmission approval, configure a server-only credential through
a secure approved route, review current OpenAI data controls and retention (store:false
is not a claim of zero retention), add per-user throttle/cost enforcement, then evaluate
synthetic calls. Never transmit full workspace/history or log prompts/secrets. No key
creation/configuration, credential retrieval, API call or billing change occurred here.

Current API shape follows the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).
Local schema validation and explicit editable review remain required even when API
constrained decoding succeeds. Account/model availability and live quality are untested.

Deployment remains pending: approved publication/target, server-only environment setup,
verified public origin/callbacks, real-user isolation and abuse limits. Existing agent
credential and external-host approval boundaries remain unchanged. No push/deploy here.
