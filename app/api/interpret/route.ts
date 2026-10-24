import {guard,boundedJson,failure} from '../../../src/server/http.ts';
import {runtimeConfig} from '../../../src/server/config.ts';
import {requestClient,requireUser} from '../../../src/server/supabase.ts';
import {interpret,interpretationCapabilities} from '../../../src/server/interpretation.ts';
export const runtime='nodejs';
export async function GET(request:Request){const headers=new Headers({'Cache-Control':'private, no-store'});try{guard(request);return Response.json(interpretationCapabilities,{headers});}catch(e){return failure(e,headers);}}
export async function POST(request:Request){const headers=new Headers({'Cache-Control':'private, no-store'});try{
 guard(request,true);const config=runtimeConfig();if(config.mode==='supabase')await requireUser(requestClient(request,config,headers));
 // Deliberately no provider registry, env-key lookup or external network call.
 return Response.json(await interpret(await boundedJson(request)),{headers});
}catch(e){return failure(e,headers);}}
