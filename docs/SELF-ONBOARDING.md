# Self-only first-login workspace setup

Approved and applied on October 24, 2026 to workspace (wovswvjkioymuabthnmq) as self_workspace_initialization. Source: supabase/migrations/20261023175600_self_workspace_candidate.sql (historical candidate filename retained). Local ignored configuration now enables WORKSPACE_SELF_ONBOARDING; other environments remain disabled by default. No real Auth account or workspace row was created during activation.

Access model:
- Public invoker RPC workspace_ensure_own() has no arguments; its private definer implementation uses only auth.uid().
- A current nonanonymous Auth session must exist, and auth.users.email_confirmed_at must be non-null. User-editable metadata is irrelevant.
- workspaces.owner_id remains unique. INSERT ... ON CONFLICT returns the same row for repeated/concurrent first requests; owner identity is never reassigned to another user.
- Direct table writes remain unavailable. Existing forced RLS limits access to each user's own workspace and records. No shared memberships or privileged roles are introduced.
- The server calls this RPC after verified password login or PKCE confirmation when the activation flag is enabled.

Verification: 48 isolated tests passed, including unconfirmed/anonymous/deleted-session denial, forged metadata ignored, cross-owner isolation, no arbitrary owner arguments, direct-write denial, and repeated/overlapping queued initialization returning one row. Embedded queued requests are not live multi-connection concurrency validation. Live catalog checks confirmed function installation, anonymous execution denied, authenticated execution allowed, direct table inserts denied, forced RLS retained, and workspace count zero. Security advisors returned no findings.

Migration caution: do not run a blanket migration push. The separate connection-persistence candidate remains intentionally unapplied, and connector-applied migration timestamps must be reconciled first.

## Ordinary signup handoff

The user-approved callback http://127.0.0.1:3212/auth/callback was added and verified after dashboard reload. Site URL remains http://localhost:3000. Dashboard inspection confirmed new signups enabled, Email provider enabled, email confirmation enabled and anonymous sign-ins disabled. No other Auth setting was changed.

User opens http://127.0.0.1:3212/login in the Codex browser, selects Create an account, enters their own email/password and sends the confirmation email themselves. Follow the email link in the SAME browser to preserve the PKCE verifier cookie. After confirmation, the app initializes only that user's private workspace. Existing confirmed application accounts may sign in instead. A Supabase dashboard login is not an application account.

Default SMTP restricts recipients to project-team email addresses; use the existing team email for initial testing. No custom SMTP or paid service was configured. Actual email delivery, confirmed-session initialization and hosted multi-user/multi-connection behavior remain pending the user flow. No signup email was sent by development automation. The dashboard's technical-issue banner may affect provider availability; successful schema/configuration operations do not prove Auth delivery availability.
