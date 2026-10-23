import { localRepository } from '../storage/local-repository.ts';
import { supabaseRepository } from '../storage/supabase-repository.ts';
import { runtimeConfig } from './config.ts';
import { openStore } from './store.ts';
import { requestClient, requireUser } from './supabase.ts';

export async function requestRepository(request: Request, headers: Headers) {
  const config = runtimeConfig();
  if (config.mode === 'sqlite') return localRepository(openStore());
  const client = requestClient(request, config, headers);
  await requireUser(client);
  // No caller workspace/user ID is accepted. RPCs derive ownership from auth.uid().
  return supabaseRepository(client);
}
