import {DatabaseSync} from 'node:sqlite';
import {existsSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {OPENAI_RESPONSES_URL,commandOutputSchema} from './openai-interpretation.ts';
import type {OpenAITransport} from './openai-interpretation.ts';
// Conservative fixed allowance, not a provider-wide billing cap. No automatic refunds.
export const TEST_POLICY={id:'luna-standard-2026-10-24-v1',model:'gpt-6-luna',inputTokenCeiling:1050000,outputTokenCeiling:2048,inputNanoUsd:250,outputNanoUsd:500,reserveMicroUsd:500000,expiresAt:'2026-10-31T00:00:00Z'} as const;
export const estimatedCeilingMicroUsd=Number((BigInt(TEST_POLICY.inputTokenCeiling)*BigInt(TEST_POLICY.inputNanoUsd)+BigInt(TEST_POLICY.outputTokenCeiling)*BigInt(TEST_POLICY.outputNanoUsd)+999n)/1000n);
export class TestBudget {
 private db:DatabaseSync;
 // Must already exist: missing/deleted ledgers never silently reset an allowance.
 constructor(path:string){if(process.env.VERCEL)throw new Error('local_budget_unavailable_on_vercel');if(!existsSync(path))throw new Error('budget_not_initialized');this.db=new DatabaseSync(path);this.db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');}
 static initialize(path:string,config:{approved:boolean;limitMicroUsd:number}){
  if(process.env.VERCEL)throw new Error('local_budget_unavailable_on_vercel');
  if(existsSync(path))throw new Error('budget_already_exists');
  if(!Number.isSafeInteger(config.limitMicroUsd)||config.limitMicroUsd<0||config.limitMicroUsd>1000000)throw new Error('invalid_budget_limit');
  closeSync(openSync(path,'wx',0o600)); const db=new DatabaseSync(path);try{db.exec('PRAGMA synchronous=FULL; BEGIN IMMEDIATE; CREATE TABLE budget(singleton INTEGER PRIMARY KEY CHECK(singleton=1),approved INTEGER NOT NULL,limit_micro INTEGER NOT NULL,policy TEXT NOT NULL); CREATE TABLE reservations(request_id TEXT PRIMARY KEY,digest TEXT NOT NULL,reserved_micro INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN (\'reserved\',\'returned\',\'uncertain\')));');db.prepare('INSERT INTO budget VALUES(1,?,?,?)').run(config.approved?1:0,config.limitMicroUsd,TEST_POLICY.id);db.exec('COMMIT');}finally{db.close();}
 }
 reserve(requestId:string,digest:string,now=Date.now()){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(requestId)||! /^[a-f0-9]{64}$/.test(digest))throw new Error('invalid_budget_request');
  this.db.exec('BEGIN IMMEDIATE');try{
   const b=this.db.prepare('SELECT * FROM budget WHERE singleton=1').get() as {approved:number;limit_micro:number;policy:string}|undefined;
   if(!b||b.approved!==1||b.policy!==TEST_POLICY.id||now>=Date.parse(TEST_POLICY.expiresAt)||!Number.isSafeInteger(now))throw new Error('budget_not_approved_or_expired');
   const prior=this.db.prepare('SELECT digest FROM reservations WHERE request_id=?').get(requestId) as {digest:string}|undefined;
   if(prior)throw new Error(prior.digest===digest?'attempt_already_reserved':'attempt_payload_conflict');
   const used=this.db.prepare('SELECT coalesce(sum(reserved_micro),0) n FROM reservations').get() as {n:number};
   if(used.n+TEST_POLICY.reserveMicroUsd>b.limit_micro)throw new Error('budget_exhausted');
   this.db.prepare("INSERT INTO reservations VALUES(?,?,?,'reserved')").run(requestId,digest,TEST_POLICY.reserveMicroUsd);this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 finish(requestId:string,state:'returned'|'uncertain'){this.db.prepare("UPDATE reservations SET state=? WHERE request_id=? AND state='reserved'").run(state,requestId);}
 summary(){return this.db.prepare('SELECT count(*) attempts,coalesce(sum(reserved_micro),0) reservedMicroUsd FROM reservations').get();}
 close(){this.db.close();}
}
export function budgetedTransport(ledger:TestBudget,requestId:string,transport:OpenAITransport):OpenAITransport{
 return async(url,body,signal)=>{
  // Freeze the charged request; no mutation can swap in tools/model/tiers after reservation.
  const json=JSON.stringify(body);if(Buffer.byteLength(json)>65536)throw new Error('request_too_large');const sent=JSON.parse(json);
  const allowed=['model','store','stream','max_output_tokens','instructions','input','text','service_tier'];
  if(url!==OPENAI_RESPONSES_URL||Object.keys(sent).some(k=>!allowed.includes(k))||sent.model!==TEST_POLICY.model||sent.service_tier!=='default'||sent.max_output_tokens!==2048||sent.store!==false||sent.stream!==false)throw new Error('unpriced_request');
  const exact=(value:unknown,fields:string[])=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===fields.sort().join(',');
  const entry=sent.input?.[0],part=entry?.content?.[0];
  if(typeof sent.instructions!=='string'||sent.instructions.length>12000||!Array.isArray(sent.input)||sent.input.length!==1||!exact(entry,['role','content'])||entry.role!=='user'||!Array.isArray(entry.content)||entry.content.length!==1||!exact(part,['type','text'])||part.type!=='input_text'||typeof part.text!=='string'||part.text.length>12000||JSON.stringify(sent.text)!==JSON.stringify({format:{type:'json_schema',name:'workspace_proposal',strict:true,schema:commandOutputSchema}}))throw new Error('unpriced_request');
  if(signal.aborted)throw new Error('request_aborted');
  ledger.reserve(requestId,createHash('sha256').update(json).digest('hex'));
  try{const result=await transport(url,sent,signal);ledger.finish(requestId,'returned');return result;}
  catch(e){ledger.finish(requestId,'uncertain');throw e;}
  // Every reservation is permanently counted, including HTTP failures and unknown outcomes.
 };
}

