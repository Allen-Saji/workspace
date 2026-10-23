import { confirmationCode,completeConfirmation } from '../../../src/server/auth-flow.ts';
import { runtimeConfig } from '../../../src/server/config.ts';
import { requestClient } from '../../../src/server/supabase.ts';
export const runtime='nodejs';
export async function GET(request:Request){
  const headers=new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});
  const config=runtimeConfig();
  let success=false;
  try{
    confirmationCode(request,config.origin);
    if(config.mode!=='supabase')throw new Error('unconfigured');
    const client=requestClient(request,config,headers);
    await completeConfirmation(client,request,config.origin);success=true;
  }catch{/* Never log callback codes, cookies or upstream error messages. */}
  headers.set('Location',new URL(success?'/':'/login?confirmation=failed',config.origin).href);
  return new Response(null,{status:303,headers});
}
