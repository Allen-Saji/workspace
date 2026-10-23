import { DomainError,WORKSPACE,idField,keys,object } from '../../../src/domain/contracts.ts';
import { applyCommand,undoCommand } from '../../../src/domain/commands.ts';
import { boundedJson,failure,guard } from '../../../src/server/http.ts';
import { runtimeConfig } from '../../../src/server/config.ts';
import { openStore } from '../../../src/server/store.ts';
export const runtime='nodejs';
export async function POST(request:Request){
  try{
    guard(request,true);if(runtimeConfig().mode!=='sqlite')throw new DomainError('command_backend_unavailable');
    const body=object(await boundedJson(request));keys(body,['action','proposal','commandId']);
    const db=openStore();try{
      const result=body.action==='apply'?applyCommand(db,body.proposal):body.action==='undo'?undoCommand(db,idField(body.commandId)):body.action==='receipt'?db.command(WORKSPACE,idField(body.commandId)):null;
      if(!['apply','undo','receipt'].includes(String(body.action)))throw new DomainError('invalid_schema');
      return Response.json({receipt:result},{headers:{'Cache-Control':'private, no-store'},status:result?200:404});
    }finally{db.close();}
  }catch(e){return failure(e);}
}
