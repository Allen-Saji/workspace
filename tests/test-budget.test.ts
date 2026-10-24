import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Worker} from 'node:worker_threads';
import {TestBudget,TEST_POLICY,estimatedCeilingMicroUsd,budgetedTransport} from '../src/server/test-budget.ts';
import {OPENAI_RESPONSES_URL,commandOutputSchema} from '../src/server/openai-interpretation.ts';
const now=Date.parse('2026-10-24T00:00:00Z');
test('budget requires approval, persists charged attempts and never refunds unknown outcomes/retries',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'workspace-budget-'));const path=join(dir,'budget.sqlite');try{
 assert.throws(()=>new TestBudget(path),/not_initialized/);TestBudget.initialize(path,{approved:false,limitMicroUsd:1000000});let b=new TestBudget(path);assert.throws(()=>b.reserve('a','a'.repeat(64),now),/not_approved/);b.close();
 const active=join(dir,'approved-fixture.sqlite');TestBudget.initialize(active,{approved:true,limitMicroUsd:1000000});assert.throws(()=>TestBudget.initialize(active,{approved:true,limitMicroUsd:1000000}),/exists/);
 b=new TestBudget(active);b.reserve('one','a'.repeat(64),now);b.close();b=new TestBudget(active);assert.throws(()=>b.reserve('one','a'.repeat(64),now),/already_reserved/);assert.throws(()=>b.reserve('one','b'.repeat(64),now),/payload_conflict/);b.finish('one','uncertain');b.reserve('two','b'.repeat(64),now);assert.throws(()=>b.reserve('three','c'.repeat(64),now),/exhausted/);assert.equal(b.summary()!.reservedMicroUsd,1000000);assert.throws(()=>b.reserve('four','d'.repeat(64),Date.parse(TEST_POLICY.expiresAt)),/expired/);b.close();assert.equal(estimatedCeilingMicroUsd,263524);assert.ok(TEST_POLICY.reserveMicroUsd>estimatedCeilingMicroUsd);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('independent workers cannot oversubscribe one durable allowance',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'workspace-budget-race-'));const path=join(dir,'budget.sqlite');try{TestBudget.initialize(path,{approved:true,limitMicroUsd:500000});
 const workers=Array.from({length:4},(_,i)=>new Worker(new URL('./helpers/budget-worker.ts',import.meta.url),{workerData:{path,id:'worker'+i}}));
 await Promise.all(workers.map(w=>new Promise<void>((resolve,reject)=>{w.once('message',()=>resolve());w.once('error',reject);})));const results=workers.map(w=>new Promise<boolean>((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);}));workers.forEach(w=>w.postMessage('go'));assert.equal((await Promise.all(results)).filter(Boolean).length,1);await Promise.all(workers.map(w=>w.terminate()));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('unapproved guard blocks transport before network and rejects unpriced features',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'workspace-budget-transport-'));const path=join(dir,'budget.sqlite');try{TestBudget.initialize(path,{approved:false,limitMicroUsd:1000000});const b=new TestBudget(path);let calls=0;const send=budgetedTransport(b,'test',async()=>{calls++;return new Response();});const body={model:'gpt-6-luna',service_tier:'default',max_output_tokens:2048,store:false,stream:false,instructions:'Synthetic test',input:[{role:'user',content:[{type:'input_text',text:'Add task test'}]}],text:{format:{type:'json_schema',name:'workspace_proposal',strict:true,schema:commandOutputSchema}}};await assert.rejects(send(OPENAI_RESPONSES_URL,body,new AbortController().signal),/not_approved/);await assert.rejects(send(OPENAI_RESPONSES_URL,{...body,tools:[]},new AbortController().signal),/unpriced/);assert.equal(calls,0);b.close();}finally{rmSync(dir,{recursive:true,force:true});}
});

