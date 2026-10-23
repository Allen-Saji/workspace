import { DomainError,WORKSPACE,idField } from '../domain/contracts.ts';
import { applyCommand,undoCommand,validateProposal } from '../domain/commands.ts';
import type { CommandReceipt } from '../domain/commands.ts';
import { runtimeConfig } from './config.ts';
import { requestClient,requireUser } from './supabase.ts';
import { openStore } from './store.ts';
export async function commandRepository(request:Request,headers:Headers){
 const config=runtimeConfig();
 if(config.mode==='sqlite'){
   const db=openStore();return {
     apply:async(input:unknown)=>applyCommand(db,input),undo:async(id:string)=>undoCommand(db,id),
     receipt:async(id:string)=>db.command(WORKSPACE,idField(id)),history:async()=>db.commands(WORKSPACE),close:()=>db.close(),
   };
 }
 const client=requestClient(request,config,headers);await requireUser(client);
 async function call<T>(name:string,args?:Record<string,unknown>):Promise<T>{
   const {data,error}=await client.rpc(name,args);
   if(error)throw new DomainError(['auth_required','workspace_not_provisioned','invalid_schema','invalid_text','invalid_enum','invalid_date','invalid_interval','invalid_revision','revision_conflict','kind_conflict','idempotency_conflict','duplicate_target','explicit_timezone_required','unknown_command','undo_expired','invalid_id'].includes(error.message)?error.message:'storage_unavailable');
   return data as T;
 }
 return {
   apply:(input:unknown)=>call<CommandReceipt>('workspace_command_apply',{proposal:validateProposal(input)}),
   undo:(id:string)=>call<CommandReceipt>('workspace_command_undo',{command_id:idField(id)}),
   receipt:(id:string)=>call<CommandReceipt|null>('workspace_command_receipt',{command_id:idField(id)}),
   history:()=>call<CommandReceipt[]>('workspace_command_history'),close(){},
 };
}
