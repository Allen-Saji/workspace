import { DomainError,idField,keys,object } from '../../../src/domain/contracts.ts';
import { boundedJson,failure,guard } from '../../../src/server/http.ts';
import { commandRepository } from '../../../src/server/command-repository.ts';
export const runtime='nodejs';
export async function GET(request:Request){
 const headers=new Headers({'Cache-Control':'private, no-store'});
 try{guard(request);const db=await commandRepository(request,headers);try{return Response.json({commands:await db.history()},{headers});}finally{db.close();}}
 catch(e){return failure(e,headers);}
}
export async function POST(request:Request){
 const headers=new Headers({'Cache-Control':'private, no-store'});
 try{
   guard(request,true);const body=object(await boundedJson(request));keys(body,['action','proposal','commandId']);
   if(!['apply','undo','receipt'].includes(String(body.action)))throw new DomainError('invalid_schema');
   const db=await commandRepository(request,headers);try{
     const result=body.action==='apply'?await db.apply(body.proposal):body.action==='undo'?await db.undo(idField(body.commandId)):await db.receipt(idField(body.commandId));
     return Response.json({receipt:result},{headers,status:result?200:404});
   }finally{db.close();}
 }catch(e){return failure(e,headers);}
}
