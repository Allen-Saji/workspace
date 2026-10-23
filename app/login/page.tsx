'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
export default function Login() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Request': 'local-ui' }, body: JSON.stringify({ action: 'signin', email: form.get('email'), password: form.get('password') }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.code === 'configuration_required' ? 'Hosted sign-in is not configured. The local workspace needs no account.' : 'Unable to sign in. Check your details or try again later.');
      router.replace('/'); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to sign in.'); }
    finally { setBusy(false); }
  }
  return <main className="panel" style={{ maxWidth: 480, margin: '10vh auto', padding: 32 }}>
    <Link href="/">← Workspace</Link><h1>Welcome back.</h1>
    <p>Sign in to your hosted workspace. Your local development data stays on this computer.</p>
    <form className="editor" onSubmit={submit}>
      <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254}/></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024}/></label>
      {error ? <p role="alert" className="error">{error}</p> : null}
      <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form><p className="muted">Accounts and password recovery must be configured before hosted rollout. No automatic signup.</p>
  </main>;
}
