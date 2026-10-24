import { runtimeConfig } from '../../src/server/config.ts';
import { googleAvailable } from '../../src/server/google-auth.ts';
import GoogleLogin from './google-login';
export const dynamic = 'force-dynamic';
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  let available = false;
  try { available = googleAvailable(runtimeConfig()); } catch { /* Fail closed if configuration is incomplete. */ }
  return <GoogleLogin available={available} failed={query.confirmation === 'failed'} />;
}
