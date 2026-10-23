# Command review (local MVP)

Today > Plan from text supports at most ten lines using these exact formats:

```text
task: Buy milk
note: Weekend | Visit the library
meeting: Practice | 2026-10-25 09:00 | 2026-10-25 09:30
```

This is a deterministic grammar, not general AI interpretation. Users may paste dictated text; no microphone or model provider is connected. Relative dates, destructive requests and ambiguous named targets are refused. Dates use Asia/Kolkata. The review shows explicit offsets and IST rendering. Users can edit fields and explicitly select an existing record to update its reviewed revision.

The interpreter returns a typed Proposal and never writes. A future provider must produce the same proposal contract and still require explicit review/apply. Server validation remains authoritative and shares manual mutation validation. The local command route rejects hosted mode; no silent SQLite fallback. Hosted atomic command RPCs and ownership tests remain a separate phase.

SQLite commits the entire group, record histories and command receipt in one BEGIN IMMEDIATE transaction. Stable command IDs and canonical payload digests make retries return the original receipt; changed payloads under the same ID fail. Receipt lookup recovers an uncertain response. All targets must have the expected revisions. Undo checks every resulting revision before changing anything, advances revisions on restored updates, removes records created by that command, and records its own durable receipt. Repeated undo is idempotent. Seven-day undo expiry is enforced server-side. It does not undo external effects; commands perform none.

The tab retains its draft/proposal/receipt in sessionStorage until explicitly cleared or closed. This is a convenience, not the durable record: server receipts persist in the commands table. A lost tab currently needs the saved command ID and receipt API to recover old receipts; a full command-history UI is still pending. Unknown outcomes lock editing until receipt lookup; known validation errors preserve the editable proposal. Closing the dialog never applies a proposal.

Authorization: loopback-only SQLite owner UI uses the existing strict host/origin/CSRF boundary. External agent tokens cannot invoke this endpoint. No new hosted schema, credentials or grants are introduced.

Verification: isolated tests cover invalid/ambiguous input, explicit timezone, atomic rollback including history/receipt, restart persistence, altered retries, workspace isolation, stale apply, stale undo, repeated undo and expiry. Browser QA exercised three-action apply, edited title, back/cancel, reload and undo on desktop plus mobile layout. Original personal SQLite data was not used.

## Ordinary hosted sessions (read-only assessment)

The existing /api/auth route only supports signInWithPassword and local sign-out, followed by server getUser verification. Existing confirmed users of this exact project's Auth service can sign in; a Supabase dashboard account is not an application Auth account. Signup, confirmation callback and password recovery UI are absent.

The supported non-admin next step is a publishable-key signUp flow with user-controlled email/password, email confirmation, then ordinary password sign-in (SSR confirmation/redirect handling must follow Supabase's PKCE guidance). Two controlled, confirmed identities are needed for real multi-user isolation testing. Default SMTP recipient restrictions and rate limits must be checked before proposing actual sends; this review did not send mail, create users or access admin secrets. Workspace membership provisioning must also be handled through an approved owner-safe path, not user-editable metadata.

References: https://supabase.com/docs/guides/auth/passwords and https://supabase.com/docs/guides/auth/server-side/nextjs
