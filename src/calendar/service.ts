import { createHash, randomBytes } from 'node:crypto';
import { parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { DomainError } from '../domain/contracts.ts';
import { runtimeConfig } from '../server/config.ts';
import { requestClient, requireUser } from '../server/supabase.ts';
import { integrationKey, seal, unseal } from './crypto.ts';
import { calendarStore } from './store.ts';
import type { VerifiedCalendarOwner } from './store.ts';
import { CALENDAR_SCOPES, GoogleCalendar, providerJson } from './provider.ts';
import type { CalendarConfig, CalendarStore, TokenBundle } from './types.ts';

const STATE_COOKIE = 'workspace-calendar-state';
type OAuthState = { state: string; verifier: string; expiresAt: number; tokenRevision: number };

export function calendarConfig(origin: string, env: Record<string, string | undefined> = process.env): CalendarConfig | null {
  if (!env.WORKSPACE_GOOGLE_CLIENT_ID || !env.WORKSPACE_GOOGLE_CLIENT_SECRET || !env.WORKSPACE_INTEGRATION_KEY) return null;
  try { return { clientId: env.WORKSPACE_GOOGLE_CLIENT_ID, clientSecret: env.WORKSPACE_GOOGLE_CLIENT_SECRET, key: integrationKey(env.WORKSPACE_INTEGRATION_KEY), origin }; }
  catch { return null; }
}

export async function calendarService(request: Request, headers: Headers) {
  const runtime = runtimeConfig(), config = calendarConfig(runtime.origin);
  // Configuration status is private, too; never return it before authentication.
  let verified: VerifiedCalendarOwner | undefined;
  if (runtime.mode === 'supabase') {
    const client = requestClient(request, runtime, headers);
    verified = { client, userId: await requireUser(client) };
  }
  let storage: CalendarStore | null = null;
  async function provider() {
    if (!config) throw new DomainError('calendar_configuration_required');
    storage ??= await calendarStore(request, headers, runtime, verified);
    return new GoogleCalendar(storage, config);
  }
  function cookie(value: string, maxAge: number) {
    headers.append('Set-Cookie', serializeCookieHeader(STATE_COOKIE, value, { httpOnly: true, sameSite: 'lax', secure: runtime.origin.startsWith('https:'), path: '/auth/calendar', maxAge }));
  }
  return {
    async status() {
      if (!config) return { configured: false, connected: false, reconnectRequired: false, reason: 'calendar_configuration_required' };
      try {
        const google = await provider(); const stored = await google.store.get('tokens');
        if (!stored.ciphertext) return { configured: true, connected: false, reconnectRequired: false };
        const token = unseal<TokenBundle & { reconnectRequired?: boolean }>(stored.ciphertext, `${google.store.identity}:tokens`, config.key);
        return { configured: true, connected: !token.reconnectRequired, reconnectRequired: !!token.reconnectRequired };
      } catch (error) {
        if (error instanceof DomainError && error.code === 'calendar_storage_unavailable') return { configured: false, connected: false, reconnectRequired: false, reason: 'calendar_storage_unavailable' };
        if (error instanceof DomainError && error.code === 'calendar_token_invalid') return { configured: true, connected: false, reconnectRequired: true, reason: 'calendar_reconnect_required' };
        throw error;
      }
    },
    async connect() {
      const google = await provider();
      const current = await google.store.get('oauth'), tokens = await google.store.get('tokens');
      const state: OAuthState = { state: randomBytes(32).toString('base64url'), verifier: randomBytes(48).toString('base64url'), expiresAt: Date.now() + 10 * 60_000, tokenRevision: tokens.revision };
      const encrypted = seal(state, `${google.store.identity}:oauth`, config!.key);
      await google.store.set('oauth', encrypted, current.revision);
      cookie(encrypted, 600);
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search = new URLSearchParams({ client_id: config!.clientId, redirect_uri: runtime.origin + '/auth/calendar/callback', response_type: 'code',
        scope: CALENDAR_SCOPES.join(' '), access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent', state: state.state,
        code_challenge_method: 'S256', code_challenge: createHash('sha256').update(state.verifier).digest('base64url') }).toString();
      return { url: url.href };
    },
    async callback() {
      const google = await provider(), params = new URL(request.url).searchParams;
      const cookieValue = parseCookieHeader(request.headers.get('cookie') ?? '').find(c => c.name === STATE_COOKIE)?.value;
      cookie('', 0);
      if (!cookieValue || !params.get('state')) throw new DomainError('calendar_oauth_invalid');
      const stored = await google.store.get('oauth');
      if (!stored.ciphertext || stored.ciphertext !== cookieValue) throw new DomainError('calendar_oauth_invalid');
      const state = unseal<OAuthState>(cookieValue, `${google.store.identity}:oauth`, config!.key);
      if (state.state !== params.get('state') || state.expiresAt < Date.now()) throw new DomainError('calendar_oauth_invalid');
      // Consume before code exchange; replay and two racing callbacks cannot win.
      await google.store.set('oauth', null, stored.revision);
      if (params.has('error')) throw new DomainError('calendar_consent_denied');
      const code = params.get('code');
      if (!code || code.length > 4096) throw new DomainError('calendar_oauth_invalid');
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config!.clientId, client_secret: config!.clientSecret,
          redirect_uri: runtime.origin + '/auth/calendar/callback', code, code_verifier: state.verifier, grant_type: 'authorization_code' }) });
      const data = await providerJson(response);
      if (!response.ok) throw new DomainError('calendar_oauth_failed');
      const scopes = typeof data.scope === 'string' ? data.scope.split(' ') : [];
      if (CALENDAR_SCOPES.some(scope => !scopes.includes(scope))) throw new DomainError('calendar_scope_denied');
      const current = await google.store.get('tokens');
      // A disconnect or another connection completed during consent.
      if (current.revision !== state.tokenRevision) throw new DomainError('calendar_revision_conflict');
      // prompt=consent should return an offline token. Do not reuse a prior
      // account's refresh token when the Google account chooser changed users.
      if (typeof data.refresh_token !== 'string' || typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') throw new DomainError('calendar_offline_access_required');
      const tokens: TokenBundle = { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000, scopes };
      await google.store.set('tokens', seal(tokens, `${google.store.identity}:tokens`, config!.key), current.revision);
    },
    async disconnect() {
      const google = await provider(); const stored = await google.store.get('tokens');
      const oauth = await google.store.get('oauth');
      await google.store.set('oauth', null, oauth.revision); cookie('', 0);
      if (!stored.ciphertext) return { disconnected: true, revoked: true };
      const tokens = unseal<TokenBundle>(stored.ciphertext, `${google.store.identity}:tokens`, config!.key);
      // Retain encrypted credentials if revocation fails so the user can retry.
      // Locally erasing a failed revocation would leave an unmanageable grant.
      let response: Response;
      try { response = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refreshToken }) }); }
      catch { throw new DomainError('calendar_revocation_failed'); }
      if (!response.ok) {
        const data = await providerJson(response);
        if (!(response.status === 400 && data.error === 'invalid_token')) throw new DomainError('calendar_revocation_failed');
      }
      try { await google.store.set('tokens', null, stored.revision); }
      catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'calendar_revision_conflict') throw error;
        const latest = await google.store.get('tokens');
        if (latest.ciphertext) {
          const value = unseal<TokenBundle>(latest.ciphertext, `${google.store.identity}:tokens`, config!.key);
          // Clear a racing refresh of the revoked grant, never a newer account.
          if (value.refreshToken !== tokens.refreshToken) throw error;
          await google.store.set('tokens', null, latest.revision);
        }
      }
      return { disconnected: true, revoked: true };
    },
    calendars: async () => (await provider()).calendars(),
    events: async (calendarId: string, from: string, to: string) => (await provider()).events(calendarId, from, to),
    freebusy: async (calendarId: string, from: string, to: string) => (await provider()).freebusy(calendarId, from, to),
    preview: async (requestId: string, event: unknown) => (await provider()).preview(requestId, event),
    apply: async (proposal: string, confirmed: boolean) => (await provider()).apply(proposal, confirmed),
    close() { storage?.close(); },
  };
}
