# Journal

Open **Journal** in workspace navigation. **Your journal** is your personal daily
entry. Type or dictate with a tool such as Wispr Flow into the text area, then choose
**Save journal**. Dictation tools that type into a focused text field need no special
Workspace integration. The manual editor does not call OpenAI.

Use the date picker to write an earlier day or open a recent saved entry. Each day
has one current entry and saved revisions. Changes require the current revision;
editing in another tab cannot silently overwrite a newer save. A stale draft stays
visible with the option to compare the saved entry. The last 20 revisions are available
through **View earlier revisions**; the database retains the full revision history.

Unsaved drafts and pending save requests stay in this tab's session storage, scoped
to workspace and date. A failed or interrupted save keeps its request ID and exact
text for **Recover save**. A successful retry returns its original saved result even
if the day has since been revised. Saved entries are stored in Supabase in hosted
mode, with the same verified owner/session boundary as other workspace records.
Loopback SQLite development uses `.data/personal-journal.sqlite` instead.

## Writing through the mascot

Click the side companion to open the assistant. If the companion is hidden, use
**Assistant** in the header. Type or dictate a request such as:

> Write my journal for today: I finished the API integration and tested the save flow.

The mascot proposes journal text from what you supply. It does not infer personal
experiences from your task list or impersonate a connected agent. Existing journal
text is not included in model context automatically. The server adds new proposed
text after any entry already saved for that date, then shows the complete result for
review. **Save journal entry** confirms the write; **Discard journal preview** leaves
the saved entry unchanged. Journal writes require review even when the assistant's
single-change auto-save option is on. Pending previews can be recovered when reopening
the assistant in the same browser tab.

The assistant uses its existing approved owner-only AI allowance. Wispr Flow types
text into the selected field; Workspace's separate microphone button uses its existing
bounded transcription route. No additional microphone permission or transcription
service is needed for externally dictated text.

## Connected agent journals

**Agent journals** displays daily summaries by date and connection. It loads the
latest 100 agent entries and filters them by the selected date. An agent publishes
its own results, blockers, next steps and intentional evidence links using the portable
[Workspace reporting skill](../public/skills/workspace-reporting/SKILL.md) and the
[v2 HTTP contract](../public/skills/workspace-reporting/references/contract.md).
The app serves the skill at `/skills/workspace-reporting/SKILL.md`.

The agent needs an approved `reports:append` / `receipts:read` connection at an
enabled origin. It maintains one revisable diary per connection/local date, preserves
its event IDs for retry recovery, and keeps tokens in its host's secret store. These
credentials cannot read or edit personal journals. Names and work claims are supplied
by agents; a receipt confirms storage rather than independent verification of work.

Saved agent entries remain owner-readable when new publishing is disabled. This
feature does not enable transport, issue credentials, install a schedule, or wake an
agent. See [deployment controls](DEPLOYMENT-READINESS.md) before activating publishing
and [the agent diary protocol](AGENT-DIARY.md) for lifecycle and token limits.

## Database setup

Review and apply `20261026180836_personal_journal.sql` after the existing owner and
agent reporting migrations. It adds private forced-RLS personal journal and version
tables plus a narrow authenticated-owner RPC. No direct client table grants, anonymous
RPC access, service-role key or new agent permissions are required. The operator should
verify grants and owner isolation after migration. Do not replay earlier migrations.
