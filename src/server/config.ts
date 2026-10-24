import { DomainError } from '../domain/contracts.ts';
export type RuntimeConfig = { mode: 'sqlite'; origin: string } | { mode: 'supabase'; origin: string; url: string; publishableKey: string };
export function runtimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const mode = env.WORKSPACE_STORAGE ?? 'sqlite';
  if (mode === 'sqlite') {
    if (env.VERCEL) throw new DomainError('configuration_required');
    const origin = env.WORKSPACE_ORIGIN ?? 'http://127.0.0.1:3210';
    try {
      const parsed = new URL(origin);
      if (parsed.origin !== origin || parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password) throw new Error('invalid');
    } catch { throw new DomainError('configuration_required'); }
    return { mode, origin };
  }
  if (mode !== 'supabase') throw new DomainError('configuration_required');
  try {
    const origin = new URL(env.WORKSPACE_ORIGIN ?? '');
    const url = new URL(env.SUPABASE_URL ?? '');
    const key = env.SUPABASE_PUBLISHABLE_KEY ?? '';
    if ((env.VERCEL && origin.protocol !== 'https:') || origin.origin !== env.WORKSPACE_ORIGIN || origin.username || origin.password ||
        !(origin.protocol === 'https:' || (origin.protocol === 'http:' && origin.hostname === '127.0.0.1')) ||
        url.protocol !== 'https:' || url.username || url.password || url.origin !== env.SUPABASE_URL ||
        !key.startsWith('sb_publishable_')) throw new Error('invalid');
    return { mode, origin: origin.origin, url: url.origin, publishableKey: key };
  } catch { throw new DomainError('configuration_required'); }
}
