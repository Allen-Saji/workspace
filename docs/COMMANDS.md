# Command review (local MVP)

Today > Plan from text supports at most ten lines using these exact formats:

```text
task: Buy milk
note: Weekend | Visit the library
meeting: Practice | 2026-10-25 09:00 | 2026-10-25 09:30
```

This is a deterministic grammar, not general AI interpretation. Users may paste dictated text; no microphone or model provider is connected. Relative dates, destructive requests and ambiguous named targets are refused. Dates use Asia/Kolkata. The review shows explicit offsets and IST rendering. Users can edit fields and explicitly select an existing record to update its reviewed revision.

The interpreter returns a typed Proposal and never writes. A future provider must produce the same proposal contract and still require explicit review/apply. Server validation remains authoritative and shares manual mutation validation. The command repository selects SQLite or verified-session Supabase RPCs with no fallback. Hosted RPCs derive the workspace from auth.uid() and reuse the existing workspace row lock. The additive command_transactions migration was applied to the approved empty Workspace project; forced RLS and no direct write grants are preserved. Live authenticated validation remains pending confirmed sessions.

SQLite commits the entire group, record histories and command receipt in one BEGIN IMMEDIATE transaction. Stable command IDs and canonical payload digests make retries return the original receipt; changed payloads under the same ID fail. Receipt lookup recovers an uncertain response. All targets must have the expected revisions. Undo checks every resulting revision before changing anything, advances revisions on restored updates, removes records created by that command, and records its own durable receipt. Repeated undo is idempotent. Seven-day undo expiry is enforced server-side. It does not undo external effects; commands perform none.

The tab retains its draft/proposal/receipt in sessionStorage until explicitly cleared or closed. This is a convenience, not the durable record: server receipts persist in the commands table. Command history loads the latest 100 durable receipts after tab loss/reload, shows before/after values and offers explicit reviewed undo with cancel. Draft keys are workspace-specific. Unknown outcomes lock editing until receipt lookup; known validation errors preserve the editable proposal. Closing the dialog never applies a proposal.

Authorization: loopback-only SQLite owner UI uses the existing strict host/origin/CSRF boundary. External agent tokens cannot invoke this endpoint. No credentials, accounts or agent grants are introduced. The new hosted command table and narrow RPC permissions follow the existing owner-isolation model.

Verification: isolated tests cover invalid/ambiguous input, explicit timezone, atomic rollback including history/receipt, restart persistence, altered retries, workspace isolation, stale apply, stale undo, repeated undo and expiry. Browser QA exercised three-action apply, edited title, back/cancel, reload and undo on desktop plus mobile layout. Original personal SQLite data was not used.

## Hosted verification

See AUTH-ROLLOUT.md for ordinary signup and remaining setup. Embedded Postgres exercises real SQL/RLS with synthetic Auth claims, including overlapping queued requests (one stale writer rejected); it does not reproduce hosted multi-connection lock contention. The live migration has zero command rows and zero workspace memberships. Security advisors: no findings. Performance: informational unused commands_history index on the empty table (https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
