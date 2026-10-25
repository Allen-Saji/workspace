"use client";
import Link from "next/link";
import Brand from "../../src/ui/Brand";
import GoogleSignInButton from "../../src/ui/GoogleSignInButton";
export default function GoogleLogin({
  available,
  failed,
  localDevelopment,
}: {
  available: boolean;
  failed: boolean;
  localDevelopment: boolean;
}) {
  return (
    <main className="auth-shell">
      <div className="panel auth-card">
        <Brand />

        <h1>Sign in to Workspace</h1>
        <p>Open your private workspace with Google.</p>
        {failed && (
          <p role="alert" className="callout">
            Sign-in did not finish. Please try again.
          </p>
        )}
        {!available && (
          <div role="status" className="callout">
            Google sign-in is not configured for this environment.
          </div>
        )}
        <GoogleSignInButton available={available} />
        {localDevelopment ? (
          <Link href="/app" className="local-workspace-link">
            Open local workspace
          </Link>
        ) : null}
        <p className="muted">
          Only your basic profile and email are requested. Gmail, Drive, and
          Calendar are not connected.
        </p>
        <details>
          <summary>About your data</summary>
          <p>
            Local development data stays on this computer and is not imported
            when you sign in.
          </p>
        </details>
      </div>
    </main>
  );
}
