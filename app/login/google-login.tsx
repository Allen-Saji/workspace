'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
export default function GoogleLogin({ available, failed }: { available: boolean; failed: boolean }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const restore = () => { pending.current = false; setBusy(false); };
    window.addEventListener('pageshow', restore);
    return () => window.removeEventListener('pageshow', restore);
  }, []);
  async function signIn() {
    if (!available || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/google', { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Workspace-Request': 'local-ui',
      }, body: '{}', signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok || typeof result.url !== 'string') throw new Error('unavailable');
      window.location.assign(result.url);
    } catch {
      setError('Google sign-in could not start. Please try again when setup is available.');
      pending.current = false; setBusy(false);
    }
  }
  return <main className="panel" style={{ maxWidth: 480, margin: '5vh auto', padding: 32 }}>
    <Link href="/">Back to Workspace</Link>
    <p className="eyebrow">A LITTLE SPACE FOR YOUR DAY</p>
    <h1>Make yourself at home.</h1>
    <p>Use your Google account to open your private workspace. No new password to remember.</p>
    {failed && <p role="alert" className="callout">Sign-in was cancelled, expired, or could not finish. Nothing here confirms a completed sign-in. Start again in this browser when you are ready.</p>}
    {!available && <div role="status" className="callout"><h2>Google sign-in is being set up</h2><p>The connection is not ready yet. You can return to Workspace while setup is completed.</p></div>}
    <button className="primary" style={{ width: '100%', marginTop: 20 }} disabled={!available || busy} onClick={signIn}>{busy ? 'Opening Google…' : 'Continue with Google'}</button>
    {error && <p role="alert" className="error">{error}</p>}
    <p className="muted">Sign-in requests only your basic profile and email address. It does not connect Gmail, Drive, or Calendar.</p>
    <p className="muted">Your local development data stays on this computer. Signing in does not import it.</p>
  </main>;
}
