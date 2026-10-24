# Workspace brand assets and metadata

- `app/icon.svg`: scalable W/open-journal mark, navy on butter yellow with coral bookmark.
- `app/favicon.ico`: embedded 32px PNG for conventional favicon requests.
- `app/apple-icon.png`: 180x180 home-screen icon.
- `app/opengraph-image.png`: 1200x630 static social card using the approved notebook
  illustration. No private content, account names, screenshots or live claims.
- `scripts/generate-brand.mjs`: reproducible local SVG/Sharp composition. Sharp is the
  installed Next dependency; no external font, image or paid service call.

Next's file metadata conventions serve icons and OG image with size/type/alt tags.
Twitter uses summary_large_image with the same public brand art. Title/description
cover day planning, tasks, goals, learning and agent reports without claiming general AI.
Only workspace and login pages set noindex/nofollow/nocache. There is no site-wide
robots exclusion that would block an eventual public landing page.

`WORKSPACE_PUBLIC_ORIGIN` must only be set after the exact HTTPS deployment origin is
verified. Do not set the intended workspace.allensaji.dev merely because it is planned.
Locally, a validated loopback WORKSPACE_ORIGIN supplies local image URLs. No canonical
is emitted for the private app/login pages. When a public landing is implemented, add
its canonical at that page using the verified public origin; don't inherit `/` across
all private routes. Deployment and social crawler availability are not yet verified.

## Isolated visual QA

`WORKSPACE_QA_BUILD=1` selects `.next-qa`, preserving the existing `.next` review build.
Build and run on 127.0.0.1:3218 with WORKSPACE_STORAGE=sqlite and
WORKSPACE_CONNECTIONS=ephemeral-test. `node scripts/browser-qa.mjs` launches a separate
headless Edge using Playwright core, with fresh contexts at 1440x1000 and 390x844.
It mocks only the workspace snapshot with empty synthetic UI data, blocks non-loopback
requests, and uses real in-memory test pairing routes. It never opens the user's browser
profile, Auth session or personal SQLite file. Evidence stays in ignored artifacts/.
The script checks viewport width/overflow, review/cancel/back/reload/revocation,
rendered metadata, served asset dimensions/types and runtime JS errors.

Verified 2026-10-24: actual rendered HTML contains title/description, summary_large_image,
OG width 1200/height 630, icon/apple links and private-page noindex. No invented canonical
or proposed public domain is emitted. Image routes returned 200 with expected content
types and dimensions. Both generated images were viewed. Desktop/mobile screenshots
are artifacts/agent-desktop-qa.png and artifacts/agent-mobile-qa.png (synthetic only).
