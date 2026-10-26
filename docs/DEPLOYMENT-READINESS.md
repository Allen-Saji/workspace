# Production deployment

Workspace runs on Vercel's Node 24 runtime with Supabase storage. SQLite is restricted
to loopback development and fails closed on Vercel. The application does not need a
Supabase service-role key. Production must use an exact HTTPS origin.

## Required configuration

Set production variables in the hosting provider's secret controls. Keep preview and
development credentials separate, and never include `.env.local` in deployment source.

- `WORKSPACE_STORAGE=supabase`
- `WORKSPACE_ORIGIN`: exact HTTPS origin, without a trailing slash
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
- `WORKSPACE_GOOGLE_AUTH=enabled`
- `WORKSPACE_SELF_ONBOARDING=enabled`, after its migration is installed
- `WORKSPACE_PUBLIC_ORIGIN`: set only after verifying the custom domain and HTTPS

The public origin enables landing-page canonical metadata and the sitemap. Dashboard,
login, approval, and API routes remain private or non-indexable as appropriate. Noindex
is not access control; session verification and database ownership checks protect data.

Optional assistant and Calendar variables are documented in [ASSISTANT.md](ASSISTANT.md)
and [CALENDAR.md](CALENDAR.md). Preserve `WORKSPACE_INTEGRATION_KEY` across deployments:
overwriting it without migrating encrypted records breaks existing connections and
request recovery. The assistant uses a durable Supabase reservation ledger, with an
explicitly enabled owner and a shared $1 daily ceiling. This does not limit unrelated
use of the same OpenAI key.

## Authentication and domains

Add the custom domain to the Vercel project and use the DNS records returned for that
project. Verify HTTPS before advertising the hostname. Preserve unrelated DNS records.

Configure the exact `/auth/callback` URL in Supabase's redirect allowlist and set its
Site URL to the production origin. Retain only development callbacks still in use.
The Google sign-in client redirects to Supabase's existing Auth callback. The separate
Calendar callback is `<production-origin>/auth/calendar/callback`.

Google OAuth publishing and Google verification are separate steps. Basic profile
sign-in can work while the OAuth application is in Testing. Calendar access in Testing
requires an approved test user and can expire after seven days. Broader distribution
requires completed branding, an accessible privacy policy, domain verification where
required, declared scopes, and any review Google requests. Do not describe a published
or unverified app as Google-approved.

## External agent transport

For a demo release without public agent onboarding, leave `WORKSPACE_CONNECTIONS`
unset and disable both database activation rows. Environment gating alone does not
close the direct Supabase RPC surface:

```sql
update workspace_private.agent_activation set enabled=false where singleton;
update workspace_private.device_activation set enabled=false where singleton;
```

These switches preserve existing records and audit history. Public agent rollout needs
its own abuse controls, retention, operational monitoring, and token lifecycle review.
Registration and polling buckets are global; one caller can consume shared capacity.
Review signup and ordinary workspace-write abuse controls before broad promotion too.

## Release verification

- Run tests, lint, typecheck, and a production build for the reviewed source.
- Verify new-account sign-in and the existing owner's session on the actual origin.
- Confirm anonymous API reads and cross-origin writes fail with no-store responses.
- Check separate-account records, history, Calendar access, and paid-AI denial.
- Submit conflicting edits from independent clients; stale writes must fail visibly.
- Test a Calendar create and edit without attendees before testing invitations.
- Test microphone transcription in the intended demo browser. API presence alone is
  insufficient; browser speech services can fail even when their interface exists.
- Inspect database advisors and privileges. RPC-only private tables intentionally have
  RLS with no direct-access policies; do not add permissive policies to silence notices.
- Verify public metadata, robots, sitemap, icons, and social images contain no user data.
- Confirm enabled paid requests use the existing durable ledger, not a fresh allowance.

Do not replay migrations blindly. Connector-applied migration versions can differ from
local filenames; compare migration names and installed definitions before changes.

## Rollback and incident handling

Keep the last known working deployment and its configuration. Roll back application
code without deleting user data or replaying schema migrations. Close agent transport
at the database switches if its rollout fails. Disable assistant access if paid-request
controls fail. Never log environment values, OAuth credentials, audio, or raw provider
errors. Rotate exposed provider credentials through their provider and replace the
hosting secrets; migrate encrypted data before rotating the integration encryption key.

## References

- [Vercel Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Vercel Hobby limits](https://vercel.com/docs/plans/hobby)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google OAuth audience](https://support.google.com/cloud/answer/15549945?hl=en)
- [Google brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
