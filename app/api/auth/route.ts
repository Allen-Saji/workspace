import { DomainError, keys, object, textField } from '../../../src/domain/contracts.ts';
import { runtimeConfig } from '../../../src/server/config.ts';
import { boundedJson, failure, guard } from '../../../src/server/http.ts';
import { requestClient, requireUser } from '../../../src/server/supabase.ts';
import { requestSignup } from '../../../src/server/auth-flow.ts';
import { initializeOwnWorkspace } from '../../../src/server/onboarding.ts';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  try {
    guard(request, true);
    const config = runtimeConfig();
    if (config.mode !== 'supabase') throw new DomainError('configuration_required');
    const body = object(await boundedJson(request));
    const client = requestClient(request, config, headers);
    if (body.action === 'signout') {
      keys(body, ['action']);
      await requireUser(client);
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw new DomainError('auth_required');
    } else {
      keys(body, ['action','email','password']);
      if (body.action !== 'signin' && body.action !== 'signup') throw new DomainError('invalid_schema');
      const email = textField(body.email, 254);
      const password = textField(body.password, 1024);
      if(body.action==='signup'){
        await requestSignup(client,email,password,config.origin);
        // Generic response avoids revealing whether the address already exists.
        return Response.json({ok:true,confirmationRequired:true},{headers});
      }
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new DomainError('auth_required');
      await requireUser(client);
    }
    if(body.action==='signin')await initializeOwnWorkspace(client);
    return Response.json({ ok: true }, { headers });
  } catch (error) { return failure(error, headers); }
}
