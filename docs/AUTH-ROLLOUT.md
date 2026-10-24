> Current login direction (2026-10-24): Google is primary; password signup UI is removed. See [GOOGLE-AUTH.md](GOOGLE-AUTH.md) for activation status and remaining setup. Earlier email-flow notes below are retained as implementation history.

# Ordinary signup and confirmation

The local hosted-mode preview is http://127.0.0.1:3212/login. User enters their own email/password; automation must not enter real passwords. Signup uses the existing publishable-key server client, preserves confirmation, and reports a generic check-inbox result without revealing whether an account exists. Passwords are never put in drafts, storage, URLs or logs by app code. Cancel swaps the form and clears its fields. Unknown network outcomes do not trigger automatic email retries.

The SSR client uses PKCE. A confirmation link must return to exactly http://127.0.0.1:3212/auth/callback in the same browser that started signup. The route accepts only a single bounded code, checks the configured Host, exchanges through Supabase, verifies getUser, and redirects only to / or /login?confirmation=failed. No caller-controlled next URL or provider error is reflected. Session cookies are HttpOnly/SameSite=Lax (Secure on HTTPS), and responses are private/no-store with no-referrer on the callback. Missing verifier, expired/reused code and interrupted confirmation fail safely. All protected APIs reverify the user; there is no Server Component auth state requiring a separate refresh proxy.

## Signup handoff status

- The exact local callback was approved, added and verified after reload on October 24. Site URL remains http://localhost:3000.
- Default Supabase SMTP restricts recipients to project-team email addresses and currently limits sends to 2/hour. No custom SMTP was configured. The user should use their existing project-team email; a second controlled identity may need a separately approved delivery arrangement.
- User opens the local URL, selects Create an account, enters their own details and clicks Send confirmation email, then follows the email link in the same browser. No signup or email was submitted during development.
- The self-only initialization migration is approved/applied and locally enabled. See SELF-ONBOARDING.md. Verified confirmation or password login initializes only the current confirmed user's private workspace. No real workspace row or agent grant was created during activation.

Actual Auth/PostgREST multi-user and multi-connection concurrency checks remain pending those sessions and workspace memberships. Embedded Postgres uses synthetic Auth claims and cannot establish a hosted pass. Do not obtain admin credentials or insert Auth users directly.

Official references checked: https://supabase.com/docs/guides/auth/passwords, https://supabase.com/docs/guides/auth/server-side/creating-a-client, https://supabase.com/docs/guides/auth/auth-smtp. Changelog reviewed October 23, 2026; upcoming CBC TLS retirement does not require changes to the current Node runtime.
