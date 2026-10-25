import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calendarService } from '../src/calendar/service.ts';
import { CALENDAR_SCOPES } from '../src/calendar/provider.ts';
import { localCalendarStore } from '../src/calendar/store.ts';

test('calendar OAuth binds and consumes state, exchanges PKCE, stores ciphertext and revokes', async () => {
  const cwd = process.cwd(), previousFetch = globalThis.fetch;
  const names = ['WORKSPACE_STORAGE', 'WORKSPACE_ORIGIN', 'WORKSPACE_GOOGLE_CLIENT_ID', 'WORKSPACE_GOOGLE_CLIENT_SECRET', 'WORKSPACE_INTEGRATION_KEY', 'VERCEL'];
  const old = new Map(names.map(name => [name, process.env[name]]));
  const folder = mkdtempSync(join(tmpdir(), 'workspace-calendar-test-'));
  process.chdir(folder);
  process.env.WORKSPACE_STORAGE = 'sqlite'; process.env.WORKSPACE_ORIGIN = 'http://127.0.0.1:3210';
  process.env.WORKSPACE_GOOGLE_CLIENT_ID = 'test-client'; process.env.WORKSPACE_GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.WORKSPACE_INTEGRATION_KEY = randomBytes(32).toString('base64'); delete process.env.VERCEL;
  const request = (url = '/api/calendar', cookie = '') => new Request('http://127.0.0.1:3210' + url, { headers: { host: '127.0.0.1:3210', cookie } });
  try {
    const headers = new Headers(); const service = await calendarService(request(), headers);
    assert.equal((await service.status()).connected, false);
    const { url } = await service.connect(); const authorization = new URL(url);
    assert.equal(authorization.origin, 'https://accounts.google.com');
    assert.equal(authorization.searchParams.get('access_type'), 'offline');
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    const cookie = headers.get('set-cookie')!.split(';')[0]; assert.match(headers.get('set-cookie')!, /HttpOnly/i); service.close();
    let exchanges = 0, revocations = 0;
    globalThis.fetch = async (url, init) => {
      if (url === 'https://oauth2.googleapis.com/revoke') { revocations++; return new Response(null, { status: 200 }); }
      assert.equal(url, 'https://oauth2.googleapis.com/token'); exchanges++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), authorization.searchParams.get('code_challenge'));
      assert.equal(body.get('redirect_uri'), 'http://127.0.0.1:3210/auth/calendar/callback');
      return Response.json({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_in: 3600, scope: CALENDAR_SCOPES.join(' ') });
    };
    const callbackUrl = '/auth/calendar/callback?code=test-code&state=' + authorization.searchParams.get('state');
    const incorrect = await calendarService(request(callbackUrl.replace(/state=.*/, 'state=wrong'), cookie), new Headers());
    await assert.rejects(incorrect.callback(), /calendar_oauth_invalid/); incorrect.close(); assert.equal(exchanges, 0);
    const callback = await calendarService(request(callbackUrl, cookie), new Headers()); await callback.callback(); callback.close(); assert.equal(exchanges, 1);
    const repeat = await calendarService(request(callbackUrl, cookie), new Headers()); await assert.rejects(repeat.callback(), /calendar_oauth_invalid/); repeat.close();
    const storage = localCalendarStore(); const encrypted = (await storage.get('tokens')).ciphertext!; storage.close();
    assert.ok(encrypted.startsWith('v1.')); assert.ok(!encrypted.includes('test-refresh-token'));
    const connected = await calendarService(request(), new Headers()); assert.equal((await connected.status()).connected, true);
    const deniedHeaders = new Headers(); const attempt = await calendarService(request(), deniedHeaders);
    const deniedUrl = new URL((await attempt.connect()).url); attempt.close();
    const deniedCookie = deniedHeaders.get('set-cookie')!.split(';')[0];
    const denied = await calendarService(request('/auth/calendar/callback?error=access_denied&state=' + deniedUrl.searchParams.get('state'), deniedCookie), new Headers());
    await assert.rejects(denied.callback(), /calendar_consent_denied/); denied.close();
    assert.equal(exchanges, 1); assert.equal((await connected.status()).connected, true);
    const deniedReplay = await calendarService(request('/auth/calendar/callback?code=replay&state=' + deniedUrl.searchParams.get('state'), deniedCookie), new Headers());
    await assert.rejects(deniedReplay.callback(), /calendar_oauth_invalid/); deniedReplay.close();
    const revokeFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('simulated network failure'); };
    await assert.rejects(connected.disconnect(), /calendar_revocation_failed/);
    assert.equal((await connected.status()).connected, true);
    globalThis.fetch = revokeFetch;
    await connected.disconnect(); assert.equal(revocations, 1); assert.equal((await connected.status()).connected, false); connected.close();
  } finally {
    globalThis.fetch = previousFetch; process.chdir(cwd);
    for (const [name, value] of old) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});
