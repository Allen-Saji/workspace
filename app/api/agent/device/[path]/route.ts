import {createClient} from '@supabase/supabase-js';
import {guard,boundedJson,failure} from '../../../../../src/server/http.ts';
import {runtimeConfig} from '../../../../../src/server/config.ts';
import {requestClient,requireUser} from '../../../../../src/server/supabase.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Activation requires a reviewed source change, not merely an environment flag.
const DEVICE_AUTHORIZATION_REVIEWED:boolean=true;
export async function POST(request:Request,context:{params:Promise<{path:string}>}){
 const headers=new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});
 try{
  guard(request);
  if(!DEVICE_AUTHORIZATION_REVIEWED)return Response.json({error:'setup_pending'},{status:503,headers});
  const {path}=await context.params;
  if(!['start','poll','inspect','approve','deny'].includes(path))return Response.json({error:'invalid_action'},{status:400,headers});
  const config=runtimeConfig();if(config.mode!=='supabase')throw Error('configuration_required');
  const owner=['inspect','approve','deny'].includes(path);
  if(owner)guard(request,true);
  else if(request.headers.has('cookie'))return Response.json({error:'scope_denied'},{status:403,headers});
  const client=owner?requestClient(request,config,headers):createClient(config.url,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  if(owner)await requireUser(client);
  const {data,error}=await client.rpc('workspace_device',{action:path,payload:await boundedJson(request)});
  if(error)return Response.json({error:'storage_unavailable'},{status:503,headers});
  // Public URL carries a lookup ID only, never the verifier or credential.
  if(path==='start'&&data.requestId)data.approvalUrl=config.origin+'/connect#'+data.requestId;
  return Response.json(data,{headers,status:data.error?400:200});
 }catch(e){return failure(e,headers);}
}


