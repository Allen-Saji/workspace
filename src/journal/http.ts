import {createClient} from '@supabase/supabase-js';
import {DomainError,idField,keys,object} from '../domain/contracts.ts';
import {runtimeConfig} from '../server/config.ts';
import {boundedJson,failure,guard} from '../server/http.ts';
import {requestClient,requireUser} from '../server/supabase.ts';
import {enabled,hostedEnabled,testHarness,HOSTED_JOURNAL_REVIEWED} from '../connections/http.ts';
import {validateJournal} from './contracts.ts';
export async function handleJournal(request:Request,path:string){
 const headers=new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});
 try{
  guard(request);if(new URL(request.url).search)throw new DomainError('invalid_schema');
  const local=enabled(),hosted=hostedEnabled()&&HOSTED_JOURNAL_REVIEWED;if(!local&&!hosted)return Response.json({error:{code:'connections_disabled',retryable:false}},{status:503,headers});
  if(path==='journal'&&request.method==='GET'){
   if(local)return Response.json(testHarness().journal('local-test-owner','isolated-connection-test'),{headers});
   const config=runtimeConfig();if(config.mode!=='supabase')throw new DomainError('configuration_required');
   const client=requestClient(request,config,headers);await requireUser(client);const {data,error}=await client.rpc('workspace_agent_journal');if(error)throw new DomainError('storage_unavailable');return Response.json(data,{headers});
  }
  if(request.method!=='POST'||request.headers.has('cookie')||request.headers.get('content-type')!=='application/json'||!['diary','status','receipts'].includes(path))throw new DomainError('scope_denied');
  const bearer=request.headers.get('authorization')??'';if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer))throw new DomainError('auth_required');const token=bearer.slice(7);
  let input=await boundedJson(request);
  if(path==='receipts'){const v=object(input);keys(v,['eventId']);input={eventId:idField(v.eventId)};}else{const report=validateJournal(input);if(report.kind!==path)throw new DomainError('invalid_schema');input=report;}
  if(local){const h=testHarness();const result=path==='receipts'?{receipt:h.journalReceipt(token,(input as {eventId:string}).eventId)}:h.ingestJournal(token,input);return Response.json(result,{headers});}
  const config=runtimeConfig();if(config.mode!=='supabase')throw new DomainError('configuration_required');
  const client=createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {data,error}=await client.rpc('workspace_agent_journal_transport',{action:path,credential:token,payload:input});
  if(error)throw new DomainError('storage_unavailable');if(data?.error){const allowed=new Set(['connections_disabled','auth_required','scope_denied','rate_limited','revision_conflict','timezone_conflict','idempotency_conflict','invalid_schema','invalid_local_date','invalid_timezone','invalid_evidence','invalid_timestamp','invalid_revision']);throw new DomainError(allowed.has(data.error)?data.error:'storage_unavailable');}
  return Response.json(data,{headers});
 }catch(e){if(e instanceof DomainError&&e.code==='rate_limited')return Response.json({error:{code:e.code,retryable:true}},{status:429,headers:{...Object.fromEntries(headers),'Retry-After':'60'}});return failure(e,headers);}
}
