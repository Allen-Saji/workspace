# Workspace branding

Workspace uses a light floating-workshop theme: violet actions, lavender surfaces,
a mint robot companion and small yellow accents. The public headline is
"A place for your plans."

## Assets

- `app/icon.svg`: source-controlled robot-head mark, also used in page branding.
- `app/favicon.ico`: 16px, 32px and 48px PNG entries in a conventional ICO file.
- `app/apple-icon.png`: 180x180 Apple home-screen icon.
- `public/brand/icon-192.png` and `icon-512.png`: web app manifest icons.
- `app/opengraph-image.png`: 1732x908 static social card with the robot and floating
  islands. `app/opengraph-image.alt.txt` supplies its accessible description.
- `public/landing/`: generated hero and closing illustrations without baked-in UI.
- `public/arcade/`: robot sprite atlas and dashboard workshop illustration.

Run `node scripts/build-brand-icons.mjs` after editing `app/icon.svg` to regenerate
its raster exports. This uses Sharp supplied by the pinned Next.js installation.
The social card and larger illustrations are generated artwork; UI text remains HTML.

## Routes and metadata

- `/`: public landing page. Verified signed-in users redirect to `/app`.
- `/login`: Google sign-in; verified signed-in users redirect to `/app`.
- `/app`: authenticated hosted dashboard. Explicit loopback SQLite development
  continues to work without hosted authentication.
- `/connect`: agent permission review. It is not a public search entry point.

Set `WORKSPACE_PUBLIC_ORIGIN` to the verified HTTPS production origin, without a
trailing slash, to enable the landing canonical URL, public indexing and the
single-entry sitemap. Without it, previews remain non-indexable and the sitemap
is empty. Never infer a public domain from incoming Host headers or preview URLs.
Private routes declare noindex and are excluded from the sitemap. Robots rules
are discovery controls, not authorization; page and API authorization remain separate.

The web app manifest launches `/app`, which applies the normal authentication
boundary. No offline support or service worker is implied by the manifest.
