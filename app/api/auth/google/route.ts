import { DomainError, keys, object } from '../../../../src/domain/contracts.ts';
import { runtimeConfig } from '../../../../src/server/config.ts';
import { googleAvailable, startGoogle } from '../../../../src/server/google-auth.ts';
import { boundedJson, failure, guard } from '../../../../src/server/http.ts';
import { requestClient } from '../../../../src/server/supabase.ts';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  try {
    guard(request, true);
    keys(object(await boundedJson(request)), []);
    const config = runtimeConfig();
    if (!googleAvailable(config) || config.mode !== 'supabase') throw new DomainError('configuration_required');
    const url = await startGoogle(requestClient(request, config, headers), config);
    return Response.json({ url }, { headers });
  } catch (error) { return failure(error, headers); }
}
