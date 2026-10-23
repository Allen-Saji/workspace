# Allen's Personal Workspace — local development slice

This feature branch adds an opt-in Supabase/auth adaptation. See
[the phase architecture and rollout gates](docs/SUPABASE-PHASE.md).
It is locally tested; the approved dedicated Supabase schema is now applied, with
authenticated hosted validation still pending. Nothing is deployed to Vercel.
SQLite remains the code default; this feature worktree has ignored local hosted configuration.

Status: working local vertical slice with responsive Today, Learning, Agents and Context views. Approved B/C references and four generated illustrations were inspected from the user-downloaded asset archive.

## Current implementation

- Next.js 16 / TypeScript project with domain, storage port, SQLite adapter and route boundaries separated.
- SQLite WAL + FULL synchronous commits, versioned schema and transactional captures/report/receipts.
- Explicit relay import: no transcript access, automatic monitoring, outbound calls or credentials.
- Exact duplicate receipt recovery, changed replay rejection, revision conflicts, atomic rollback and fixed workspace/connection isolation.
- Task/lesson/capture/note/manual meeting mutation services and synthetic registration states. No real pairing or operational credentials.
- Owner acceptance, workspace save and remote acknowledgement remain independent. Local corrections retain source history and remain unsynced.
- Default SQLite mode is loopback-only (normally 127.0.0.1:3210), with strict Host/Origin and mutation header checks. The local OS user is its trust boundary; do not expose or tunnel it. The opt-in hosted adapter adds verified Supabase sessions but still requires the rollout gates in the phase document before deployment.

## Commands (developer reference; assistant owns execution)

Use installed Node24 directory in session PATH; no PowerShell execution-policy changes are needed:

```powershell
$env:PATH="$env:LOCALAPPDATA\Programs\NodeLTS\node-v24.22.1-win-x64;"+$env:PATH
$env:NEXT_TELEMETRY_DISABLED='1'
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

`Start-Workspace.cmd` starts the previously built production app on `http://127.0.0.1:3210`. This address is only on this Windows computer; it is not accessible from the parent's cloud runtime.

Data lives in `.data/workspace.sqlite`. It is local development persistence, not hosted cross-device sync. No fixture is auto-imported into the workspace. Tests use temporary isolated databases and clean up only their own temporary directories.

## Parent checkpoint ingestion procedure

1. Parent sends this development task one bounded JSON report following `fixtures/checkpoint.sample.json`, using a fresh stable eventId/checkpointId/captureId, an actual occurredAt, actual authorized checkpoint content and `isTest:false`. Do not copy the sample content as a real report. Missing source references must remain null/not_exposed. Current limits: 64 KiB, summary 4,000 chars, 20 ordinary captures of 2,000 chars each. No secrets, full transcripts, commands or permission grants.
2. This task saves the exact report to a local JSON file and runs, from this project directory:
   `node scripts/report.ts import <absolute-report-json-path>`
3. Only the resulting receipt with `committedAt`, `payloadDigest`, `receiptId` and saved records proves workspace persistence. Transport/task delivery is not a receipt.
4. Reconcile uncertain outcomes with `node scripts/report.ts receipt <eventId>`. Retry the exact payload/ID only; changed content under that ID rejects. Capture updates use the revision-aware owner mutation service; reports currently cannot overwrite captures.
5. Return the receipt to the parent. That return is not remote memory persistence, and UI verification remains a separate gate.

The CLI gets only fixed local relay scope from application code. This is an authorized file import on this OS account, not issued agent authentication. Real persistent credential setup remains a later approved action with a standard reviewed protocol.

## Interface and verification

Today supports task create/edit/done, manual meetings with date validation, learning steps with self-reported progress/evidence, and notes. Agents shows explicit reports, durable receipts and a synthetic permission rehearsal. Context exposes sources, acceptance, local revisions and unsynced corrections separately from remote acknowledgement. Hash navigation supports browser Back. Dialogs support keyboard focus and Escape.

The original local slice passed lint, typecheck, 13 unit tests and production build. Desktop (1440px) and mobile (390px) browser checks covered persistence after reload, form validation, cancellation, task editing/completion, learning evidence, duplicate and altered report replay, rejected registration, context correction and navigation. No browser console errors were observed. The Supabase phase expands coverage to 28 tests, including embedded Postgres execution; see its verification limits in the phase document.

The local review database contains conspicuously SAMPLE-labelled QA records plus one genuine parent-authored checkpoint. The checkpoint is historical; its original summary is preserved. No automatic live agent connection is claimed. Fresh installations start empty.

## Limits and follow-up

This is local development storage behind a migration-ready storage port, not hosted synchronization. Calendar and voice providers remain unconnected. Registration only rehearses synthetic scopes; production identity and credentials are not implemented. Learning is a simple editable sequence, not an assessment of mastery.

The source is organized into local feature commits. Production hosting and authentication remain future work. A prior dependency audit found five high-severity development-tool findings in the ESLint dependency chain and an ESLint end-of-support notice; a forced framework downgrade was not applied. Runtime dependency audit reported zero findings at installation.

Local verification notes and preview screenshots are excluded from Git. Existing project specifications are preserved.
