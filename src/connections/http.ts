import { DomainError, idField, keys, object } from '../domain/contracts.ts';
import { boundedJson, failure, guard } from '../server/http.ts';
import { runtimeConfig } from '../server/config.ts';
import { SCOPES, TestConnections } from './service.ts';

// Module-local, single-process test runtime. Never opens personal SQLite files.
let harness: TestConnections | undefined;
export function enabled(env: Record<string,string|undefined> = process.env) {
  return env.WORKSPACE_CONNECTIONS === 'ephemeral-test' && !env.VERCEL && runtimeConfig(env).mode === 'sqlite';
}
const owner='local-test-owner', workspace='isolated-connection-test';
export async function handle(request: Request, path: string) {
  const headers=new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});
  try {
    guard(request);
    if(new URL(request.url).search) throw new DomainError('invalid_schema');
    const active=enabled();
    if(path==='capabilities' && request.method==='GET') return Response.json({enabled:active,testOnly:true,protocol:'workspace-local-test-1',scopes:SCOPES,credentialExchange:'PKCE-S256',productionReady:false},{headers});
    if(!active) throw new DomainError('connections_disabled');
    harness ??= new TestConnections();
    if(path==='control') {
      if(request.method==='GET') return Response.json({connections:harness.list(owner,workspace),testOnly:true},{headers});
      guard(request,true);
      const v=object(await boundedJson(request)); keys(v,['action','id','scopes']);
      if(v.action==='pair') return Response.json(harness.pair(owner,workspace),{headers});
      if(!['approve','reject','revoke'].includes(String(v.action))) throw new DomainError('invalid_schema');
      return Response.json(harness.decide(owner,workspace,idField(v.id),v.action as 'approve'|'reject'|'revoke',v.scopes),{headers});
    }
    // Agent transport: no cookie authentication or credential-bearing URLs.
    if(request.method!=='POST' || request.headers.get('content-type')!=='application/json' || request.headers.has('cookie')) throw new DomainError('scope_denied');
    const input=await boundedJson(request);
    if(path==='registrations') return Response.json(harness.register(input),{headers});
    if(path==='exchange') return Response.json(harness.exchange(input),{headers});
    const authorization=request.headers.get('authorization')??'';
    if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw new DomainError('auth_required');
    const token=authorization.slice(7);
    if(path==='rotate') { keys(object(input),[]); return Response.json(harness.rotate(token),{headers}); }
    if(path==='events') return Response.json(harness.ingest(token,input),{headers});
    if(path==='receipts') {
      const v=object(input); keys(v,['eventId']);
      const receipt=harness.receipt(token,idField(v.eventId));
      return Response.json({receipt},{headers,status:receipt?200:404});
    }
    throw new DomainError('scope_denied');
  } catch(e) {
    if(e instanceof DomainError && e.code==='rate_limited') { headers.set('Retry-After','60'); return Response.json({error:{code:e.code,retryable:true}},{status:429,headers}); }
    if(e instanceof DomainError && e.code==='connections_disabled') return Response.json({error:{code:e.code,retryable:false}},{status:503,headers});
    return failure(e,headers);
  }
}
