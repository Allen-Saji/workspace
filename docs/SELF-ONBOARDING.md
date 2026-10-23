# Self-only first-login workspace candidate

Candidate: supabase/migrations/20261023175600_self_workspace_candidate.sql. NOT applied to the hosted project. No real Auth account, workspace membership, credential or agent grant was created.

Access model:
- Public invoker RPC workspace_ensure_own() has no arguments; its private definer implementation uses only auth.uid().
- A current nonanonymous Auth session must exist, and auth.users.email_confirmed_at must be non-null. User-editable metadata is irrelevant.
- workspaces.owner_id remains unique. INSERT ... ON CONFLICT returns the same row for repeated/concurrent first requests; owner identity is never reassigned to another user.
- Direct table writes remain unavailable. Existing read RLS limits access to each user's own row and records. No shared memberships or privileged roles are introduced.
- The server calls this RPC after verified password login or PKCE confirmation only when WORKSPACE_SELF_ONBOARDING=enabled. The default is disabled, and no actual environment value was enabled.

Activation requires review/application of this candidate and deliberate local activation. Do not run a blanket migration push: the earlier connection-persistence candidate is still intentionally unapplied, and connector-applied migration timestamps must be reconciled first. No live execution of this new RPC occurred.

Tests use isolated embedded Postgres with synthetic Auth rows/claims: unconfirmed and anonymous denial, deleted-session denial, forged metadata ignored, another-owner isolation, no arbitrary owner argument, direct-write denial, repeated and overlapping queued initialization returning one row. Embedded queued requests are not a live multi-connection concurrency test.

## Redirect-settings inspection result

The connector exposes no field-limited Auth URL settings read. The specific dashboard URL https://supabase.com/dashboard/project/wovswvjkioymuabthnmq/auth/url-configuration redirected to dashboard sign-in. No full Auth configuration, SMTP/password fields or secret keys were requested.

Current site_url and redirect allowlist are therefore UNVERIFIED. We cannot responsibly claim an existing allowed port or that a change is necessary. Smallest next user action: sign into that existing Supabase dashboard tab (not create a new account), so only URL Configuration can be inspected. If no suitable existing loopback callback exists, proposed exact addition is http://127.0.0.1:3212/auth/callback for this project; it was NOT changed in this pass.

The local app's signup page is http://127.0.0.1:3212/login. Do not request a signup email until callback configuration is verified. After prerequisites, the user enters their own email/password and confirms in the same browser. Default SMTP recipient limits and the second test identity remain as documented in AUTH-ROLLOUT.md.
