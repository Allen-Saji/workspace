import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { DomainError } from '../domain/contracts.ts';
import type { RuntimeConfig } from './config.ts';

export function requestClient(request: Request, config: Extract<RuntimeConfig, { mode: 'supabase' }>, headers: Headers) {
  const jar = new Map(parseCookieHeader(request.headers.get('cookie') ?? '').map(c => [c.name, c.value ?? '']));
  // Only page proxy and route handlers verify sessions. No Server Component
  // reads them; the page proxy excludes APIs to avoid duplicate refreshes.
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: config.origin.startsWith('https://'), path: '/' },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll(values, cacheHeaders) {
        for (const { name, value, options } of values) {
          jar.set(name, value);
          headers.append('Set-Cookie', serializeCookieHeader(name, value, options));
        }
        for (const [name, value] of Object.entries(cacheHeaders ?? {})) headers.set(name, value);
      },
    },
  });
}
export interface UserVerifier {
  auth: { getUser(): Promise<{ data: { user: { id: string; is_anonymous?: boolean } | null }; error: unknown }> };
}
export async function requireUser(client: UserVerifier) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || data.user.is_anonymous) throw new DomainError('auth_required');
  return data.user.id; // Not user_metadata, not an unverified getSession cookie.
}
