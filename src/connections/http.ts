import { createClient } from '@supabase/supabase-js';
import { DomainError, idField, keys, object } from '../domain/contracts.ts';
import { boundedJson, failure, guard } from '../server/http.ts';
import { runtimeConfig } from '../server/config.ts';
import { requestClient, requireUser } from '../server/supabase.ts';
import { hostedConnections } from './hosted.ts';
import { SCOPES, TestConnections } from './service.ts';
// Requires reviewed code activation plus separate database activation/grants.
export const HOSTED_CONNECTIONS_REVIEWED: boolean = false;
let harness: TestConnections | undefined;
export function enabled(env: Record<string,string|undefined> = process.env) {
  return env.WORKSPACE_CONNECTIONS === 'ephemeral-test' && !env.VERCEL && runtimeConfig(env).mode === 'sqlite';
}
export function hostedEnabled(env:Record<string,string|undefined>=process.env){
  return HOSTED_CONNECTIONS_REVIEWED && env.WORKSPACE_CONNECTIONS==='hosted' && runtimeConfig(env).mode==='supabase';
}
const owner='local-test-owner', workspace='isolated-connection-test';
export async function handle(request: Request, path: string) {
  const headers=new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});
  try {
    guard(request);
    if(new URL(request.url).search) throw new DomainError('invalid_schema');
    const local=enabled(), hosted=hostedEnabled(), active=local||hosted;
    if(path==='capabilities' && request.method==='GET') return Response.json({enabled:active,testOnly:!hosted,mode:hosted?'hosted':local?'ephemeral-test':'disabled',protocol:'workspace-scoped-reports-1',scopes:SCOPES,credentialExchange:'PKCE-S256',productionReady:false},{headers});
    if(!active) throw new DomainError('connections_disabled');
    if(local)harness ??= new TestConnections();
    if(path==='control') {
      if(request.method!=='GET' && request.method!=='POST')throw new DomainError('scope_denied');
      if(request.method==='POST')guard(request,true);
      const v=request.method==='GET'?{action:'list'}:object(await boundedJson(request));keys(v,['action','id','scopes']);
      if(hosted){
        const config=runtimeConfig();if(config.mode!=='supabase')throw new DomainError('configuration_required');
        const client=requestClient(request,config,headers);await requireUser(client);
        return Response.json(await hostedConnections(client).control(v),{headers});
      }
      if(v.action==='list')return Response.json({connections:harness!.list(owner,workspace),testOnly:true},{headers});
      if(v.action==='pair')return Response.json(harness!.pair(owner,workspace),{headers});
      if(!['approve','reject','revoke'].includes(String(v.action)))throw new DomainError('invalid_schema');
      return Response.json(harness!.decide(owner,workspace,idField(v.id),v.action as 'approve'|'reject'|'revoke',v.scopes),{headers});
    }
    // Agent bearer is never used as a Supabase JWT; cookies are never forwarded.
    if(request.method!=='POST'||request.headers.get('content-type')!=='application/json'||request.headers.has('cookie'))throw new DomainError('scope_denied');
    const input=await boundedJson(request);
    const needsToken=!['registrations','exchange'].includes(path);
    const authorization=request.headers.get('authorization')??'';
    if(needsToken&&!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))throw new DomainError('auth_required');
    const token=needsToken?authorization.slice(7):null;
    if(hosted){
      const config=runtimeConfig();if(config.mode!=='supabase')throw new DomainError('configuration_required');
      const client=createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const result=await hostedConnections(client).transport(path,token,input);
      return Response.json(result,{headers,status:path==='receipts'&&!result.receipt?404:200});
    }
    if(path==='registrations')return Response.json(harness!.register(input),{headers});
    if(path==='exchange')return Response.json(harness!.exchange(input),{headers});
    if(path==='rotate'){keys(object(input),[]);return Response.json(harness!.rotate(token!),{headers});}
    if(path==='events')return Response.json(harness!.ingest(token!,input),{headers});
    if(path==='receipts'){
      const v=object(input);keys(v,['eventId']);const receipt=harness!.receipt(token!,idField(v.eventId));
      return Response.json({receipt},{headers,status:receipt?200:404});
    }
    throw new DomainError('scope_denied');
  }catch(e){
    if(e instanceof DomainError&&e.code==='rate_limited'){headers.set('Retry-After','60');return Response.json({error:{code:e.code,retryable:true}},{status:429,headers});}
    if(e instanceof DomainError&&e.code==='connections_disabled')return Response.json({error:{code:e.code,retryable:false}},{status:503,headers});
    return failure(e,headers);
  }
}
