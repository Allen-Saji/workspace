"use client";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./GoogleSignInButton.module.css";

export default function GoogleSignInButton({
  available = true,
}: {
  available?: boolean;
}) {
  const errorId = useId();
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
        "Could not open Google. Check your connection and try again.",
      );
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className={styles.control}>
      <button
        type="button"
        className={styles.button}
        disabled={!available || busy}
        aria-busy={busy}
        aria-describedby={error ? errorId : undefined}
        onClick={signIn}
      >
        <Image
          src="/brand/google-g.png"
          width={20}
          height={20.4}
          alt=""
          unoptimized
        />
        <span aria-live="polite">
          {busy ? "Opening Google..." : "Sign in with Google"}
        </span>
      </button>
      {error && (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
