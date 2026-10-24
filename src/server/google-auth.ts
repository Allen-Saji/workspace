import { DomainError } from '../domain/contracts.ts';
import type { RuntimeConfig } from './config.ts';
export function googleAvailable(config: RuntimeConfig, enabled = process.env.WORKSPACE_GOOGLE_AUTH) {
  return config.mode === 'supabase' && enabled === 'enabled';
}
type GoogleClient = { auth: { signInWithOAuth(input: {
  provider: 'google'; options: { redirectTo: string; scopes: string; skipBrowserRedirect: boolean };
}): Promise<{ data: { url: string | null }; error: unknown }> } };
export async function startGoogle(client: GoogleClient, config: RuntimeConfig, enabled = process.env.WORKSPACE_GOOGLE_AUTH) {
  if (!googleAvailable(config, enabled) || config.mode !== 'supabase') throw new DomainError('configuration_required');
  // The SSR client supplies PKCE and stores its verifier in HttpOnly cookies.
  const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: {
    redirectTo: config.origin + '/auth/callback', scopes: 'openid email profile', skipBrowserRedirect: true,
  } });
  if (error || !data.url) throw new DomainError('google_signin_unavailable');
  let url: URL;
  try { url = new URL(data.url); } catch { throw new DomainError('google_signin_unavailable'); }
  if (url.origin !== config.url || url.pathname !== '/auth/v1/authorize' || url.username || url.password || url.hash ||
      url.searchParams.get('provider') !== 'google' || url.searchParams.get('redirect_to') !== config.origin + '/auth/callback') {
    throw new DomainError('google_signin_unavailable');
  }
  return url.href;
}
