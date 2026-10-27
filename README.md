# Workspace

A place for your plans. Workspace brings tasks, notes, learning steps and explicit
agent reports into one personal workspace, with a small animated robot companion.

## What it does

- Create and update tasks, notes and manually entered meetings.
- Track learning steps, with an evidence note for completed work.
- Focus with a Pomodoro timer, optional task linking, breaks and a distraction-free view.
- Review text-based command proposals before saving, and undo eligible commands.
- Import reports and review captured context with its source and acceptance state.
- Manage scoped agent connections and read agent-supplied reports and diary entries
  when the corresponding hosted features are enabled.
- Move, minimize, hide or pause the robot. Its reactions follow Workspace actions;
  it is not an indicator of remote agent activity.

The public landing page is at `/`. Hosted users sign in with Google and enter the
private dashboard at `/app`. Signed-in visitors to `/` or `/login` go to `/app`.
Fresh workspaces start empty and offer an action to add the first task. The landing
page's populated product preview is clearly labeled example data.

## Local development

Requires Node.js 24.22.1 or later.

```sh
npm ci
npm run dev
```

The development server binds to `http://127.0.0.1:3210`. With no hosted configuration,
SQLite is the default. Open `/app` directly for the local dashboard. Local data is
stored in the ignored `.data/workspace.sqlite` file; it is not imported into a hosted
workspace when signing in. Keep this mode on loopback.

For an existing hosted setup, configure `WORKSPACE_STORAGE=supabase`, the exact
`WORKSPACE_ORIGIN`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` in ignored local
environment configuration. Google sign-in also requires provider configuration and
`WORKSPACE_GOOGLE_AUTH=enabled`. Follow [Google authentication](docs/GOOGLE-AUTH.md),
[self-onboarding](docs/SELF-ONBOARDING.md), and the
[deployment readiness guide](docs/DEPLOYMENT-READINESS.md) for activation requirements.
Never put secrets in source control or public environment variables.

## Verification

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

Tests cover domain validation, revisions, command transactions and undo, report
replay, scoped connections, hosted storage behavior, authentication boundaries,
metadata and companion preferences. Tests use isolated test stores. Passing these
checks does not replace the deployment and access-control review in the readiness
guide.

## Branding and public metadata

The floating-workshop identity uses a mint robot, violet controls and light lavender
surfaces. [Branding documentation](docs/BRANDING.md) lists source assets and the icon
export command.

Set `WORKSPACE_PUBLIC_ORIGIN` to the verified HTTPS production origin before the
production build. It enables the canonical landing URL and a public sitemap containing
only the landing page. Without it, previews remain non-indexable. Private routes
stay excluded. The web app manifest launches `/app`; it does not imply offline support.

## Feature documentation

- [Assistant and voice](docs/ASSISTANT.md)
- [Google Calendar and imports](docs/CALENDAR.md)
- [Focus timer](docs/FOCUS.md)
- [Commands and undo](docs/COMMANDS.md)
- [Interpretation formats](docs/INTERPRETATION.md)
- [Hosted agent connections](docs/HOSTED-CONNECTIONS.md)
- [Device onboarding](docs/DEVICE-ONBOARDING.md)
- [Agent diary](docs/AGENT-DIARY.md)
- [Supabase architecture](docs/SUPABASE-PHASE.md)

The assistant requires server configuration and an approved daily budget. Google
Calendar requires separate OAuth consent and refreshes on demand. Voice input uses
browser speech recognition where available. External agents cannot automatically
schedule meetings through these owner-only routes. A report receipt proves that
Workspace saved the report, not that an external assistant remembers it or is
currently working.
