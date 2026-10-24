# Google sign-in rollout

Google is now the primary login UI. Email/password forms are removed from the main page; the existing email API and provider are preserved. No migration or change to user data, email confirmation, RLS, or membership checks is part of this change.

## Activation boundary
WORKSPACE_GOOGLE_AUTH defaults to disabled. Enable it only after the project's Google provider has been configured and reviewed. The flag is an operator readiness gate, not a live provider-health check. A provider outage after activation still yields a recoverable sign-in failure. No Google secret belongs in the application environment or repository.

The server starts OAuth only after host/origin/CSRF validation. The installed Supabase SSR client supplies PKCE, an HttpOnly SameSite=Lax verifier cookie, and a fixed callback. Only openid/email/profile are requested. No offline Google access, Gmail, Drive or Calendar scopes are requested. Returned authorization URLs must target this configured Supabase project's authorization endpoint.

The callback exchanges the code once, verifies the user with getUser, and invokes the existing self-only initializer. It never follows user-supplied next redirects or displays upstream errors. Cancellation/missing/expired codes return to a recovery message. The database still requires a live nonanonymous session and auth.users.email_confirmed_at; editable user_metadata is never authorization. Google identity verification is delegated to Supabase's provider implementation; the app does not infer confirmation from a profile claim. Real provider identity/confirmation behavior remains to be tested.

## One-time setup, not performed
1. Identify an owner-controlled Google Cloud project and an appropriate Web application OAuth client, or obtain approval to create them. Do not reuse unrelated clients without review.
2. Configure Google Auth Platform branding/contact, External audience for a personal Google account, and only openid, userinfo.email, userinfo.profile data access. Internal audience requires a Google organization.
3. For this hosted Supabase project the Google authorized redirect URI is https://wovswvjkioymuabthnmq.supabase.co/auth/v1/callback. The app callback http://127.0.0.1:3212/auth/callback is a separate Supabase redirect allowlist entry, already verified in the previous phase. Do not confuse the two.
4. Use the server OAuth flow; no Google JavaScript SDK is loaded here. If JavaScript origins are configured, include only the actual development origin; no wildcard. Production domains and branding verification require separate review.
5. Configure the client ID and secret in this project's Supabase Google provider only, via an approved secure handoff. Do not reveal or copy secrets to chat, logs, screenshots or application code. Keep nonce checks/security defaults intact. Enable provider, verify safe configuration and then enable the local readiness flag.
6. Have the user complete a normal Google consent/sign-in. Verify callback, own workspace creation, repeat sign-in, logout, cancellation and ordinary-user isolation before claiming live readiness.

Google's current Audience help explicitly exempts identity-only scopes from the usual Testing test-user-list/7-day-expiry restrictions. Do not rely on the Testing audience as an app access allowlist. Each confirmed app user gets only their own private workspace. Personal/development use has verification exceptions; publicly branded production may need verified domains, public homepage/privacy policy and brand review. Do not buy a custom domain or enable paid products for this local phase.

Supabase Social OAuth is included in Free. This identity-only setup is intended to stay free, without a paid Google API, Identity Platform, billing upgrade or custom Supabase domain. Existing Google account/project availability and any account-specific requirements are unverified; stop if a setup screen requires payment.

## Verification, 2026-10-24
- 52 tests passed, including installed-SDK PKCE/cookie generation with synthetic configuration, setup gating, minimal scopes, redirect validation, CSRF, prior callback failure handling and owner-isolation fixtures.
- Lint, typecheck and production build passed.
- Local production preview on 127.0.0.1:3212: login HTTP 200, no password input; disabled OAuth POST 503 configuration_required; cross-origin POST 403 origin_denied.
- Browser verified setup state, cancellation recovery, back navigation and no console errors.
- Requested 390px viewport did not take effect: actual DOM width remained 1265px after reload. Mobile browser verification is pending; no mobile pass claimed.
- Current Supabase provider inspection and Google Cloud inventory were denied by automatic browser approval review. No retries or alternate account-access routes were used. Last earlier observation was Google disabled; this is not fresh verification.
- No live Google flow, account creation, credential issuance/configuration, hosted changes, push or deployment.

## Sources
- https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- https://supabase.com/docs/guides/auth/server-side/advanced-guide
- https://raw.githubusercontent.com/supabase/auth/master/internal/api/provider/google.go
- https://support.google.com/cloud/answer/15549945
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- https://supabase.com/pricing
- Current changelog reviewed: https://supabase.com/changelog.md ; upcoming legacy TLS CBC removal does not require changing this Node 24 OAuth flow.

## Dedicated Google project checkpoint
The approved Google Cloud project Workspace (allen-workspace-20261024) was created on 2026-10-24 without a billing step or billing association by this agent. Existing Everdesk was not reused. OAuth setup is partially prepared with app name Workspace, the authenticated owner's approved contact email, and External/testing audience. The final Google API Services: User Data Policy agreement remains unchecked pending specific user confirmation. Branding setup has not been submitted, no OAuth client or secret has been created, and Supabase Google remains disabled. Do not recreate the project; resume its preserved setup form after resolving the policy step. No scopes or production audience changes have been saved.
