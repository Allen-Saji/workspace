# Workspace assistant

Click the side companion to open the assistant. If it is hidden, use **Assistant**
in the header. Type a request or use the microphone in a browser that supports
audio recording. The transcript is editable and is never submitted automatically. Recording shows a
pulsing indicator, elapsed time and a live microphone level meter. Waiting for
permission and transcribing have separate states. Cancelling while recording discards the clip without uploading it. Cancelling
transcription attempts to stop the request; it cannot retract audio already sent. Metering is best effort; if it is unavailable the
recording indicator and timer remain visible. Reduced motion disables looping
animations.
Optional spoken replies use the browser's speech synthesis and start disabled.

The assistant can prepare personal daily journal entries, create and edit tasks, notes and local meetings, read a calendar
agenda, find free time, and prepare Google Calendar events. Name the task you want to change so the assistant can identify the right record. Task due
dates are date-only; timed work belongs in a calendar event. Ambiguous targets or
times should produce a clarification instead of a save.

A single personal change saves automatically when the visible option is enabled.
Turn it off to review every change. Multiple changes always require review. Calendar
writes always show an event preview before confirmation, including any attendees.
Manual forms and assistant calendar requests share the same server validation.
Journal requests also always require review. New text is appended to the day's saved
entry by the server, and revision checks prevent overwriting a concurrent edit.
See [Journal](JOURNAL.md) for dictation, drafts, revisions and agent publishing.

Undo uses the existing command ledger and revision checks. Later edits can prevent
an older command from being undone. Google Calendar writes do not offer local Undo;
edit the event again or use Google Calendar.

## Server setup

The server uses the OpenAI Responses API with `gpt-6-luna`, structured output,
`store: false`, and no model-controlled tools or network access. It supplies the
latest request, up to six recent conversation messages, bounded task/note/meeting
context and, for explicit calendar-edit requests when connected, up to twenty
upcoming calendar events. Agenda and availability results are read by the server
after planning and are not sent back to the model. Report bodies,
credentials and unrelated record fields are excluded. This sends that bounded
context to OpenAI when the user submits a request.

Configure server-only environment variables from `.env.example`:

- `WORKSPACE_ASSISTANT=enabled`
- `WORKSPACE_ASSISTANT_DAILY_USD=1`
- `OPENAI_API_KEY`
- `WORKSPACE_INTEGRATION_KEY`: base64-encoded 32-byte encryption key
- `WORKSPACE_ASSISTANT_OWNER_ID`: verified Supabase account ID in hosted mode

Apply the assistant runtime migration after reviewing it. A database operator must
explicitly enable the account's workspace in `workspace_private.assistant_access`.
No browser RPC can enable billing, clear requests or reset the allowance. The app
does not require a Supabase service-role key. Local SQLite mode uses a separate
durable runtime ledger under `.data/`.

## Spending guard and retries

The runtime reserves $0.05 before each model attempt, with a shared $1 ceiling per
UTC day across enabled workspaces in the deployment. The UI shows **reserved**
budget, not the provider's actual charge. This allows up to twenty attempts per day;
failed and uncertain attempts keep their reservation. It does not cap unrelated API
key usage. The old synthetic-test allowance remains separate and is never reset.

The model request is capped at 48,000 UTF-8 bytes and 2,048 output tokens. The model
and standard tier are fixed. Pricing was checked on October 25, 2026; review the
pricing and reservation before changing models, limits or service tiers.

- [Model and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

Request IDs bind the original prompt and options. Validated plans are encrypted
and saved before execution; repeated requests replay the same plan or result and
do not start another model call. Command IDs prevent duplicate personal writes.
An interrupted model call with no saved plan remains uncertain and is not retried
automatically. Check history before starting a different request.

Unresolved requests and calendar previews can be recovered from this browser tab's
session storage, scoped to the workspace. Completed chat history is not kept in
browser storage. The server retains encrypted request replay payloads and budget
reservations; these may include request-derived personal content. Keep the
encryption key backed up and exclude it from logs and source control.

## Voice and calendar limits

Voice input records up to sixty seconds after an explicit microphone click. Stopping
sends a canonical 16 kHz mono PCM WAV to the authenticated transcription endpoint,
then to OpenAI's `gpt-transcribe` model. The server verifies duration from the audio
bytes and reserves $0.05 from the same daily ledger before contacting OpenAI.
Recordings remain in memory and are not persisted by Workspace. Encrypted transcript
replay results are retained in the existing request ledger. Closing the panel or
hiding the page cancels capture; no task or event is submitted automatically.

This avoids relying on the browser's speech recognition service. Microphone permission
and MediaRecorder/Web Audio support are still required. Typed input remains available.
[File transcription](https://developers.openai.com/api/docs/guides/speech-to-text)
and [pricing](https://developers.openai.com/api/docs/pricing) were checked on October
25, 2026: a sixty-second recording is estimated at $0.0045 before fees.

See [Calendar setup](CALENDAR.md) for separate OAuth consent, provider settings,
import limits and event confirmation. Calendar refresh is on demand rather than a
background synchronization service. MCP exposure to external assistants is not part
of this implementation.
