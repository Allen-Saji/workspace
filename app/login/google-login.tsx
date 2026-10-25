"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Brand from "../../src/ui/Brand";
export default function GoogleLogin({
  available,
  failed,
  localDevelopment,
}: {
  available: boolean;
  failed: boolean;
  localDevelopment: boolean;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const restore = () => {
      pending.current = false;
      setBusy(false);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  async function signIn() {
    if (!available || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/google", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Request": "local-ui",
        },
        body: "{}",
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok || typeof result.url !== "string")
        throw new Error("unavailable");
      window.location.assign(result.url);
    } catch {
      setError(
        "Google sign-in could not start. Please try again when setup is available.",
      );
      pending.current = false;
      setBusy(false);
    }
  }
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
        <button
          className="primary"
          disabled={!available || busy}
          onClick={signIn}
        >
          {busy ? "Opening Google..." : "Continue with Google"}
        </button>
        {localDevelopment ? (
          <Link href="/app" className="local-workspace-link">
            Open local workspace
          </Link>
        ) : null}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
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
