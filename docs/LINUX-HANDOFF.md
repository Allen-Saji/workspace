# Linux handoff — 2026-10-24

Continue branch `feature/supabase-auth` from `https://github.com/Allen-Saji/workspace`. Do not merge into main or deploy as part of setup. Read AGENTS.md and the relevant docs before changes.

## Install and verify

Use Node **24.22.1** and npm **11.19.1** (the verified Windows toolchain); Node's built-in SQLite and TypeScript execution are required. Install the Linux Node distribution, not the Windows executable. No Docker, WSL, global Next install or Supabase CLI is needed to run the app.

```sh
git clone --branch feature/supabase-auth https://github.com/Allen-Saji/workspace.git
cd workspace
node --version
npm --version
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

Use the lockfile, not dependency upgrades. These checks passed on Windows at this checkpoint; a Linux run is still required. Tests use isolated fixtures/embedded Postgres, not proof of live multi-user security.

## Reconnect the existing app

Create ignored `.env.local` locally with these names. Placeholders are not working credentials:

```dotenv
WORKSPACE_STORAGE=supabase
WORKSPACE_ORIGIN=http://127.0.0.1:3212
SUPABASE_URL=https://YOUR_EXISTING_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_LOCALLY
WORKSPACE_GOOGLE_AUTH=enabled
WORKSPACE_SELF_ONBOARDING=enabled
# Optional existing, approved local agent controls:
# WORKSPACE_CONNECTIONS=hosted
```

Use the existing Workspace Supabase project `wovswvjkioymuabthnmq`, Mumbai. Obtain its publishable configuration through the authorized normal project UI; no admin/service-role key, database password or Google client secret belongs in this app. Never paste secrets into chat or commit env files.

```sh
npx --no-install next start --hostname 127.0.0.1 --port 3212
```

Open `http://127.0.0.1:3212/` on the Linux computer. For development instead use `npx --no-install next dev --hostname 127.0.0.1 --port 3212`. The npm dev/start defaults use port 3210, so use the explicit command above with this configuration.

Supabase already permits exactly `http://127.0.0.1:3212/auth/callback`. Loopback refers to the computer running the browser: use a browser on the same Linux machine as the server. `localhost`, a different port or a LAN address is not interchangeable. A new browser needs normal Google sign-in; Windows session cookies do not transfer through Git. Google redirects to Supabase's `/auth/v1/callback`, then Supabase returns to the approved app callback. Do not change those settings just to move machines.

The existing database already has the reviewed workspace, command, connection, diary and device-authorization migrations/activations. **Do not run blanket `supabase db push`, reset, seed or replay migrations.** Local filenames and remote application versions can differ. Inspect actual migration history and schema before any future additive change. No personal SQLite import is part of setup.

## What Git intentionally does not transfer

Windows `.env.local`, `.env.openai.local`, `.data/`, SQLite databases, private reports, runtime logs, screenshots, temporary clients and browser sessions are ignored. Hosted user records remain in Supabase. A fresh local SQLite run is a separate development dataset, not a recovery of Windows records.

**AI stays off.** Normal app interpretation has no enabled live provider. The approved original US$1 test round has **one API call and US$0.50 permanently reserved**, with estimated provider token cost **US$0.0000596 before fees**. Reservations and invoice cost are different. The Windows ledger is not in Git. Do not initialize a fresh Linux budget, reset the round, assume a new dollar allowance or call the API because a ledger is missing. Reconcile the original durable accounting first, with an explicit approved continuation; the original policy expires 2026-10-31 UTC. A key must be separately supplied by the user through secure local entry if later needed. Do not search credential stores or copy the Windows key into source. Vercel cannot use this local ledger; it now fails closed there.

## Verified state and remaining work

- Google login, own private workspace initialization and hosted command saving/history/undo were exercised on Windows. Manual forms and editable command proposals work; general ongoing AI interpretation remains disabled.
- One approved temporary device-flow QA connection submitted synthetic status and diary revisions, recovered receipts and deduplicated replays. It was revoked; independent database inspection confirmed revoked status and zero stored token hashes. Audit records remain.
- **Old-token read/write denial was not live-probed:** the ephemeral client exited and lost its token. Embedded denial tests passed. Do not mint a replacement automatically.
- Live second-user isolation and independent hosted concurrency tests remain pending. Embedded tests do not substitute for those checks.
- The public reporting skill is `/skills/workspace-reporting/SKILL.md`; it documents the contract, not an installed scheduler or an external agent connection.
- See DEPLOYMENT-READINESS.md before any public release. No Vercel deployment, DNS change, ongoing model usage or new agent credential is implied by this handoff.

Final checkpoint verification: 79 tests, lint, typecheck and production build passed on Windows. No new browser flow was introduced by the two server guard fixes; previous UI QA remains the evidence for UI behavior. Linux runtime verification remains pending.
