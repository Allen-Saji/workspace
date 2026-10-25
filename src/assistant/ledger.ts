import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DomainError } from '../domain/contracts.ts';
import { runtimeConfig } from '../server/config.ts';
import { requestClient, requireUser } from '../server/supabase.ts';
import { DAILY_LIMIT_MICRO_USD, RESERVATION_MICRO_USD } from './provider.ts';

type Reservation={fresh:boolean;payload:string|null};
export interface AssistantLedger {
  summary():Promise<{limitUsd:number;usedUsd:number}>;
  reserve(id:string,digest:string):Promise<Reservation>;
  save(id:string,digest:string,payload:string):Promise<void>;
  close():void;
}
export class LocalAssistantLedger implements AssistantLedger {
  private db:DatabaseSync;
  private workspaceId:string;
  constructor(path:string,workspaceId:string){
    this.workspaceId=workspaceId;
    mkdirSync(dirname(path),{recursive:true}); this.db=new DatabaseSync(path);chmodSync(path,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS requests(workspace TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,day TEXT NOT NULL,reserved INTEGER NOT NULL,payload TEXT,PRIMARY KEY(workspace,id));`);
  }
  async summary(){const r=this.db.prepare('SELECT coalesce(sum(reserved),0) used FROM requests WHERE day=?').get(new Date().toISOString().slice(0,10)) as {used:number};return {limitUsd:DAILY_LIMIT_MICRO_USD/1e6,usedUsd:r.used/1e6};}
  async reserve(id:string,digest:string):Promise<Reservation>{
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const prior=this.db.prepare('SELECT digest,payload FROM requests WHERE workspace=? AND id=?').get(this.workspaceId,id) as {digest:string;payload:string|null}|undefined;
      if(prior){if(prior.digest!==digest)throw new DomainError('idempotency_conflict');this.db.exec('COMMIT');return {fresh:false,payload:prior.payload};}
      const day=new Date().toISOString().slice(0,10);
      const used=this.db.prepare('SELECT coalesce(sum(reserved),0) used FROM requests WHERE day=?').get(day) as {used:number};
      if(used.used+RESERVATION_MICRO_USD>DAILY_LIMIT_MICRO_USD)throw new DomainError('assistant_budget_exhausted');
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,NULL)').run(this.workspaceId,id,digest,day,RESERVATION_MICRO_USD);
      this.db.exec('COMMIT');return {fresh:true,payload:null};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  async save(id:string,digest:string,payload:string){if(payload.length>96000)throw new DomainError('payload_too_large');const r=this.db.prepare('UPDATE requests SET payload=? WHERE workspace=? AND id=? AND digest=?').run(payload,this.workspaceId,id,digest);if(r.changes!==1)throw new DomainError('unknown_request');}
  close(){this.db.close();}
}
export async function assistantLedger(request:Request,headers:Headers,workspaceId:string):Promise<AssistantLedger>{
  const config=runtimeConfig();
  if(config.mode==='sqlite')return new LocalAssistantLedger(resolve('.data/assistant-runtime.sqlite'),workspaceId);
  const client=requestClient(request,config,headers);const userId=await requireUser(client);
  // A shared API key is only available to the operator's explicitly enabled account.
  if(userId!==process.env.WORKSPACE_ASSISTANT_OWNER_ID)throw new DomainError('assistant_not_enabled');
  async function call<T>(args:Record<string,unknown>={}):Promise<T>{const {data,error}=await client.rpc('workspace_assistant_budget',args);if(error)throw new DomainError(['assistant_budget_exhausted','assistant_not_enabled','idempotency_conflict','auth_required','workspace_not_provisioned'].includes(error.message)?error.message:'storage_unavailable');return data as T;}
  return {summary:()=>call(),reserve:(id,digest)=>call({request_id:id,digest}),save:async(id,digest,payload)=>{await call({request_id:id,digest,payload});},close(){}};
}
function key(){const k=Buffer.from(process.env.WORKSPACE_INTEGRATION_KEY??'','base64');if(k.length!==32)throw new DomainError('configuration_required');return k;}
export function sealResult(workspace:string,id:string,value:unknown):string {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(`assistant:v1:${workspace}:${id}`));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64');
}
export function openResult(workspace:string,id:string,sealed:string):unknown {
  try{const b=Buffer.from(sealed,'base64');const decipher=createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28));decipher.setAAD(Buffer.from(`assistant:v1:${workspace}:${id}`));return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString('utf8'));}
  catch{throw new DomainError('assistant_replay_invalid');}
}
