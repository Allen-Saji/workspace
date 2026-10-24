# Deployment readiness — 2026-10-24

This is an audit, not a deployed-site claim. The intended `workspace.allensaji.dev` origin has not been configured or verified. No DNS, credentials, hosted grants or billing were changed by this audit.

## Platform fit

The Supabase-backed Next.js app is a candidate for Vercel's Node runtime. Vercel documents [Node 24.x support](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). [Hobby](https://vercel.com/docs/plans/hobby) is free within its limits and restricted to personal, non-commercial use; confirm the intended public/hackathon use qualifies before release. Free quotas can stop availability and are not unlimited capacity. No paid add-ons are required by the current app architecture.

Local SQLite is development-only and already refused when VERCEL is set. Hosted repositories derive ownership from the verified session and use Supabase RPCs. The standalone OpenAI test ledger also now refuses Vercel before opening or creating a file. Do not put it in `/tmp`: neither an instance-local file nor memory is a cross-instance spending limit. Hosted AI needs a separate reviewed durable transactional budget design and explicit spend authorization. Keep AI transport disabled and do not configure an OpenAI key for an initial release.

## Concrete release blockers

1. Public agent exposure needs a release review. Device authorization is source-activated and hosted legacy routes can activate with WORKSPACE_CONNECTIONS=hosted. These existing gates are **not Vercel-specific approvals**. Do not deploy the current branch publicly without either disabling public onboarding/report transport or approving/hardening that release. Supabase's direct RPC surface is already active; hiding a Next route alone does not remove it.
2. Database setup/report rate buckets are global, so one caller can consume shared capacity. Add/review per-caller abuse controls, bounded retention/cleanup and operational monitoring before opening registration broadly. Host/Origin validation, owner session checks, proof binding and token scopes are not substitutes for abuse protection. Public signup also needs quota/abuse review.
3. Live old-token probes, second-user isolation and independent hosted concurrency remain incomplete. Prior embedded checks and revoked-token-hash removal must not be described as those live tests.
4. Verify Google audience/test-user/public consent readiness before inviting arbitrary users. Keep confirmation, nonce, PKCE and RLS protections. No provider-secret copy is needed in Vercel.
5. Select and verify the exact HTTPS origin. App requests enforce exact Host/Origin; random preview domains will not automatically work. Add only the approved callback to Supabase's redirect allowlist. Vercel now rejects a configured HTTP loopback app origin.

## Configuration and privacy

Required server configuration: WORKSPACE_STORAGE=supabase, WORKSPACE_ORIGIN (exact HTTPS), SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. Enable WORKSPACE_GOOGLE_AUTH and WORKSPACE_SELF_ONBOARDING only for the existing reviewed provider/schema. Supply configuration using the hosting environment controls, not committed files or next.config env bundling. No service-role/admin keys are required. Keep WORKSPACE_CONNECTIONS unset until the public agent decision above; this alone does not disable the separately activated device route.

Set WORKSPACE_PUBLIC_ORIGIN only after the public origin is verified, for metadata/OG URLs. The root workspace, login and approval pages are noindex; metadata/OG images contain generic branding, no user records. Noindex is not access control. API auth, no-store headers and owner isolation are the protections. The static skill/contract is intentionally public and contains no credentials. There is no public marketing landing page yet; private app pages should not be made indexable for SEO.

## Minimal next release sequence

- Complete the blockers above and choose a free, eligible hosting target; no upgrade or trial.
- Obtain scoped deployment/configuration approval, set only required server variables, and keep model calls off.
- Approve the exact public OAuth callback and any intended DNS/domain change separately; no paid Supabase custom Auth domain is required for the app hostname.
- Deploy only the reviewed commit, verify Node/runtime, auth callback, owner isolation, private caching, static skill and public abuse behavior on the actual origin. Verify no persistent writes rely on deployment files.
- Preserve a rollback commit and disable newly exposed entry points if validation fails. Do not delete user data or replay migrations to roll back the UI.

Audit stopped at the Linux handoff boundary. No hosted deployment/build, new provider call, new credential or public traffic validation occurred.
