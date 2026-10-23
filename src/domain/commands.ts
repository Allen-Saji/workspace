import { createHash, randomUUID } from 'node:crypto';
import { DomainError, WORKSPACE, idField, keys, object } from './contracts.ts';
import type { WorkspaceRecord } from './contracts.ts';
import { mutateInTransaction } from './service.ts';
import type { Storage } from '../storage/port.ts';
export type Operation={id:string;kind:'task'|'meeting'|'note';expectedRevision:number;data:Record<string,unknown>};
export type Proposal={commandId:string;timezone:'Asia/Kolkata';operations:Operation[]};
export type CommandReceipt={commandId:string;receiptId:string;digest:string;committedAt:string;timezone:'Asia/Kolkata';
  changes:{before:WorkspaceRecord|null;after:WorkspaceRecord}[];undo?:{receiptId:string;committedAt:string}};
export interface CommandStorage extends Storage {
  command(workspace:string,id:string):CommandReceipt|null;
  saveCommand(workspace:string,receipt:CommandReceipt):void;
  remove(workspace:string,id:string):void;
}
export function validateProposal(input:unknown):Proposal {
  const v=object(input);keys(v,['commandId','timezone','operations']);
  const commandId=idField(v.commandId);
  if(v.timezone!=='Asia/Kolkata'||!Array.isArray(v.operations)||!v.operations.length||v.operations.length>10)throw new DomainError('invalid_schema');
  const ids=new Set<string>();
  const operations=v.operations.map(raw=>{
    const op=object(raw);keys(op,['id','kind','expectedRevision','data']);
    const id=idField(op.id);
    if(ids.has(id))throw new DomainError('duplicate_target');ids.add(id);
    if(!['task','meeting','note'].includes(String(op.kind)))throw new DomainError('invalid_schema');
    if(!Number.isSafeInteger(op.expectedRevision)||Number(op.expectedRevision)<0)throw new DomainError('invalid_revision');
    const data=object(op.data);
    if(op.kind==='meeting'&&['start','end'].some(k=>typeof data[k]!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(String(data[k]))))throw new DomainError('explicit_timezone_required');
    return {id,kind:op.kind as Operation['kind'],expectedRevision:Number(op.expectedRevision),data};
  });
  return {commandId,timezone:'Asia/Kolkata',operations};
}
function canonical(v:unknown):string {
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v!==null&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(v);
}
export function applyCommand(db:CommandStorage,input:unknown):CommandReceipt {
  const p=validateProposal(input),digest=createHash('sha256').update(canonical(p)).digest('hex');
  return db.transaction(()=>{
    const prior=db.command(WORKSPACE,p.commandId);
    if(prior){if(prior.digest!==digest)throw new DomainError('idempotency_conflict');return prior;}
    const changes=p.operations.map(op=>({before:db.get(WORKSPACE,op.id)??null,after:mutateInTransaction(db,op)}));
    const receipt:CommandReceipt={commandId:p.commandId,receiptId:randomUUID(),digest,committedAt:new Date().toISOString(),timezone:p.timezone,changes};
    db.saveCommand(WORKSPACE,receipt);return receipt;
  });
}
export function undoCommand(db:CommandStorage,id:string):CommandReceipt {
  return db.transaction(()=>{
    const r=db.command(WORKSPACE,idField(id));if(!r)throw new DomainError('unknown_command');
    if(r.undo)return r;
    if(Date.now()-Date.parse(r.committedAt)>7*86400000)throw new DomainError('undo_expired');
    for(const c of r.changes){const current=db.get(WORKSPACE,c.after.id);if(!current||current.revision!==c.after.revision)throw new DomainError('revision_conflict');}
    for(const c of r.changes){
      if(!c.before)db.remove(WORKSPACE,c.after.id);
      else {const restored={...c.before,revision:c.after.revision+1,updatedAt:new Date().toISOString()};db.put(WORKSPACE,restored);db.audit(WORKSPACE,restored);}
    }
    r.undo={receiptId:randomUUID(),committedAt:new Date().toISOString()};db.saveCommand(WORKSPACE,r);return r;
  });
}
