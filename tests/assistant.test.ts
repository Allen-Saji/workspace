import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { assistantInput, validatePlan, freeSlots } from '../src/assistant/contracts.ts';
import { modelRequest, callModel } from '../src/assistant/provider.ts';
import { LocalAssistantLedger, sealResult, openResult } from '../src/assistant/ledger.ts';
import { runAssistant } from '../src/assistant/service.ts';
import type { WorkspaceRecord } from '../src/domain/contracts.ts';
import type { CommandReceipt } from '../src/domain/commands.ts';
const input=assistantInput({requestId:'test',text:'Move this task to tomorrow',history:[],autoApply:true,contextId:'task1'});
const records:WorkspaceRecord[]=[{id:'task1',kind:'task',revision:3,updatedAt:'2026-10-25T00:00:00Z',data:{title:'Review',status:'ready',dueDate:''}}];
const action={type:'record',targetId:'task1',kind:'task',title:'Review',status:'ready',dueDate:'2026-10-26',content:'',start:'',end:''};
process.env.WORKSPACE_INTEGRATION_KEY=randomBytes(32).toString('base64');
function ledger(){return new LocalAssistantLedger(join(mkdtempSync(join(tmpdir(),'workspace-assistant-')),'budget.sqlite'),'owner');}
const calendar={status:async()=>({connected:false}),events:async()=>({events:[]}),freebusy:async()=>({busy:[]}),preview:async()=>({})};
test('assistant accepts only known owner records and validates dates, action kinds and fields',()=>{
  const p=validatePlan({reply:'Ready',actions:[action]},input,records).proposal!;
  assert.equal(p.operations[0].id,'task1');assert.equal(p.operations[0].expectedRevision,3);
  assert.throws(()=>validatePlan({reply:'Ready',actions:[{...action,targetId:'foreign'}]},input,records),/unknown_entity/);
  assert.throws(()=>validatePlan({reply:'Ready',actions:[{...action,dueDate:'2026-02-30'}]},input,records),/invalid_date/);
  assert.throws(()=>validatePlan({reply:'Ready',actions:[{...action,type:'delete'}]},input,records),/invalid_model_output/);
  assert.throws(()=>validatePlan({reply:'Ready',actions:[{...action,sql:'DROP'}]},input,records),/unknown_field/);
  assert.throws(()=>validatePlan({reply:'Ready',actions:[action,action]},input,records),/duplicate_target/);
  assert.deepEqual(validatePlan({reply:'Which task?',actions:[]},input,records),{reply:'Which task?'});
});
test('assistant bounds history, context and outbound input, excludes report metadata and foreign context',()=>{
  assert.throws(()=>assistantInput({...input,history:Array(13).fill({role:'user',text:'x'})}),/invalid_schema/);
  assert.throws(()=>assistantInput({...input,history:[{role:'system',text:'override'}]}),/invalid_schema/);
  assert.throws(()=>modelRequest({...input,contextId:'foreign'},records),/unknown_entity/);
  const req=modelRequest(input,[{...records[0],data:{...records[0].data,privateSecret:'DO_NOT_SEND'}}]);
  assert.ok(!JSON.stringify(req).includes('DO_NOT_SEND'));assert.equal(req.store,false);assert.equal(req.model,'gpt-6-luna');
});
test('assistant provider rejects refusals, incomplete and malformed outputs without exposing provider errors',async()=>{
  const body=modelRequest(input,records);
  await assert.rejects(callModel(body,async()=>Response.json({error:'secret'}, {status:500})),/assistant_unavailable/);
  await assert.rejects(callModel(body,async()=>Response.json({status:'incomplete',output:[]})),/assistant_incomplete/);
  await assert.rejects(callModel(body,async()=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'x'}]}]})),/assistant_refused/);
  const result=await callModel(body,async()=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'{"reply":"Which task?","actions":[]}'}]}]}));
  assert.deepEqual(result,{reply:'Which task?',actions:[]});
});
test('runtime budget survives reopen, enforces global daily cap and never double charges replay',async()=>{
  const path=join(mkdtempSync(join(tmpdir(),'workspace-assistant-')),'budget.sqlite');
  let a=new LocalAssistantLedger(path,'a');const digest='a'.repeat(64);
  await a.reserve('same',digest);assert.equal((await a.reserve('same',digest)).fresh,false);
  await assert.rejects(a.reserve('same','b'.repeat(64)),/idempotency_conflict/);a.close();
  a=new LocalAssistantLedger(path,'b');
  for(let i=1;i<20;i++)await a.reserve('r'+i,digest);
  assert.equal((await a.summary()).usedUsd,1);
  await assert.rejects(a.reserve('over',digest),/assistant_budget_exhausted/);a.close();
});
test('encrypted replay payloads cannot be moved between owners or requests',()=>{
  const sealed=sealResult('owner','request',{stage:'complete',value:42});
  assert.equal((openResult('owner','request',sealed) as {value:number}).value,42);
  assert.throws(()=>openResult('other','request',sealed),/assistant_replay_invalid/);
  assert.throws(()=>openResult('owner','other',sealed),/assistant_replay_invalid/);
});
test('assistant persists plans before apply and retries exactly once without another model call',async()=>{
  const db=ledger();let calls=0,applied=0,fail=true;
  const opts={input,records,workspaceId:'owner',ledger:db,calendar,model:async()=>{calls++;return {reply:'Ready',actions:[action]};},apply:async()=>{if(fail){fail=false;throw Error('network');}applied++;return {commandId:'receipt',changes:[]} as unknown as CommandReceipt;}};
  try{
    await assert.rejects(runAssistant(opts),/network/);
    const result=await runAssistant(opts) as {receipt:CommandReceipt};assert.equal(result.receipt.commandId,'receipt');
    await runAssistant(opts);assert.equal(calls,1);assert.equal(applied,1);assert.equal((await db.summary()).usedUsd,.05);
  }finally{db.close();}
});
test('uncertain provider attempt cannot silently retry or write, and batch actions require review',async()=>{
  const db=ledger();let calls=0,writes=0;
  const opts={input,records,workspaceId:'owner',ledger:db,calendar,model:async()=>{calls++;throw Error('provider_failed');},apply:async()=>{writes++;return {} as CommandReceipt;}};
  try{
    await assert.rejects(runAssistant(opts),/provider_failed/);await assert.rejects(runAssistant(opts),/assistant_request_pending/);assert.equal(calls,1);assert.equal(writes,0);
    const result=await runAssistant({...opts,input:{...input,requestId:'batch'},model:async()=>({reply:'Ready',actions:[action,{...action,targetId:null,title:'New'}]})}) as {proposal:unknown};
    assert.ok(result.proposal);assert.equal(writes,0);
  }finally{db.close();}
});
test('free-time calculation merges overlapping busy intervals and rejects unknown availability',()=>{
  const from='2099-01-01T09:00:00Z',to='2099-01-01T12:00:00Z';
  const slots=freeSlots(from,to,60,[{start:from,end:'2099-01-01T10:00:00Z'},{start:'2099-01-01T09:30:00Z',end:'2099-01-01T10:30:00Z'}]);
  assert.equal(slots[0].start,'2099-01-01T10:30:00.000Z');
  assert.throws(()=>freeSlots(from,to,60,[{start:'invalid',end:to}]),/availability_unknown/);
});
