"use client";
import { useState } from "react";
import Link from "next/link";
import Brand from "../../src/ui/Brand";
import { scopeLabel } from "../../src/ui/primitives";
type RequestView = {
  displayName: string;
  requestedScopes: string[];
  status: string;
  expiresAt: string;
};
export default function DeviceApproval() {
  const [view, setView] = useState<RequestView | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [scopes, setScopes] = useState<string[]>([]);
  async function act(action: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const id = location.hash.slice(1);
      if (!/^[a-f0-9-]{36}$/.test(id))
        throw Error("This approval link is incomplete.");
      const r = await fetch("/api/agent/device/" + action, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Request": "local-ui",
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          id,
          ...(action === "approve" ? { scopes } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok)
        throw Error(
          data.error === "setup_pending"
            ? "Device onboarding is implemented but not activated. No access was granted."
            : "Unable to complete this request. Sign in, check expiry, then refresh its status before retrying.",
        );
      if (action === "inspect") {
        setView(data);
        setScopes(data.requestedScopes);
      } else {
        setView(null);
        setMessage(
          action === "approve"
            ? "Approved. The agent must prove its request to receive access. Manage revocation on Agents."
            : "Request denied. No credential issued.",
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <div className="panel auth-card">
        <Brand />
        <h1>Connect your agent</h1>
        <p>
          Review only a connection you requested. Opening this link does not
          grant access.
        </p>
        <div className="auth-links">
          <Link href="/login" className="secondary">
            Sign in
          </Link>
          <Link href="/app#agents" className="secondary">
            Back to Agents
          </Link>
        </div>
        <div className="auth-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void act("inspect")}
          >
            Review request
          </button>
        </div>
        {view && (
          <section>
            <h2>{view.displayName}</h2>
            <p>
              Self-reported identity - not verified. Status: {view.status}.
              Expires {new Date(view.expiresAt).toLocaleString()}.
            </p>
            <p>
              Approval connects this agent to your own private workspace. It
              cannot read context or edit tasks.
            </p>
            {view.requestedScopes.map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  disabled={busy || s === "reports:append"}
                  onChange={(e) =>
                    setScopes((v) =>
                      e.target.checked ? [...v, s] : v.filter((x) => x !== s),
                    )
                  }
                />
                {scopeLabel(s)}
              </label>
            ))}
            <div className="form-actions auth-actions">
              <button
                className="primary"
                disabled={busy || view.status !== "pending"}
                onClick={() => void act("approve")}
              >
                Approve selected access
              </button>
              <button
                className="secondary"
                disabled={busy || view.status !== "pending"}
                onClick={() => void act("deny")}
              >
                Deny request
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setView(null);
                  setMessage("Cancelled review. No decision was sent.");
                }}
              >
                Cancel
              </button>
            </div>
          </section>
        )}
        {message && <p role="status">{message}</p>}
      </div>
    </main>
  );
}
