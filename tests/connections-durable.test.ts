import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { SqliteConnections, SCOPES } from '../src/connections/service.ts';
const report={schemaVersion:'1',eventId:'durable-test',checkpointId:'checkpoint',eventType:'checkpoint_reported',occurredAt:'2026-01-01T00:00:00Z',reportingMode:'explicit_checkpoint',isTest:true,summary:'SAMPLE durable test',source:{conversationRef:null,segmentRef:null,availability:'not_exposed'},entityRefs:[],captures:[]};
function request(code:string){const verifier=randomBytes(32).toString('base64url');return {verifier,input:{pairingCode:code,requestId:crypto.randomUUID(),displayName:'SAMPLE durable client',requestedScopes:SCOPES,codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256'}};}
test('restart preserves pairing, approval, receipts, rotation and revocation with hashes only',()=>{
  const folder=mkdtempSync(join(tmpdir(),'workspace-connection-test-')), path=join(folder,'isolated.sqlite');
  let now=Date.now(), db=new SqliteConnections(path,()=>now);
  try{
    const code=db.pair('alice','a').pairingCode, r=request(code);
    db.close();db=new SqliteConnections(path,()=>now);
    const pending=db.register(r.input);db.decide('alice','a',pending.id,'approve',SCOPES);
    db.close();db=new SqliteConnections(path,()=>now);
    assert.throws(()=>db.decide('bob','a',pending.id,'revoke'),/scope_denied/);
    assert.deepEqual(db.list('alice','b'),[]);
    const issued=db.exchange({registrationId:pending.id,codeVerifier:r.verifier});assert.ok('accessToken' in issued);
    const token=issued.accessToken!, saved=db.ingest(token,report);
    db.close();db=new SqliteConnections(path,()=>now);
    assert.equal(db.receipt(token,report.eventId)?.receiptId,saved.receiptId);
    assert.equal(db.ingest(token,report).status,'duplicate');
    const rotated=db.rotate(token);assert.throws(()=>db.ingest(token,report),/auth_required/);
    assert.throws(()=>db.rotate(token),/auth_required/);
    db.close();db=new SqliteConnections(path,()=>now);
    assert.equal(db.receipt(rotated.accessToken,report.eventId)?.receiptId,saved.receiptId);
    now+=3600001;assert.throws(()=>db.rotate(rotated.accessToken),/auth_required/);
    db.decide('alice','a',pending.id,'revoke');db.close();db=new SqliteConnections(path,()=>now);
    assert.equal(db.list('alice','a')[0].status,'revoked');
    assert.throws(()=>db.receipt(rotated.accessToken,report.eventId),/auth_required/);
    db.close();
    const bytes=readFileSync(path);
    for(const raw of [code,r.verifier,token,rotated.accessToken]) assert.equal(bytes.includes(Buffer.from(raw)),false,'raw secret must not be stored');
    db=new SqliteConnections(path,()=>now);
  }finally{db.close();rmSync(folder,{recursive:true,force:true});}
});
test('independent workers redeem one pairing code exactly once',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'workspace-connection-race-')), path=join(folder,'isolated.sqlite');
  const db=new SqliteConnections(path);const code=db.pair('alice','a').pairingCode;const requests=[request(code).input,request(code).input];
  const workers:Worker[]=[];
  try{
    const ready=requests.map(input=>new Promise<{worker:Worker;done:Promise<{ok:boolean;code?:string}>}>((resolve,reject)=>{
      const worker=new Worker(new URL('./helpers/redemption-worker.ts',import.meta.url),{workerData:{path,request:input}});workers.push(worker);
      worker.once('error',reject);
      worker.once('message',()=>{const done=new Promise<{ok:boolean;code?:string}>((res,rej)=>{worker.once('message',res);worker.once('error',rej);});resolve({worker,done});});
    }));
    const participants=await Promise.all(ready);participants.forEach(p=>p.worker.postMessage('go'));
    const outcomes=await Promise.all(participants.map(p=>p.done));
    assert.equal(outcomes.filter(o=>o.ok).length,1);
    assert.equal(outcomes.find(o=>!o.ok)?.code,'idempotency_conflict');
    assert.equal(db.list('alice','a').length,1);
  }finally{await Promise.all(workers.map(w=>w.terminate()));db.close();rmSync(folder,{recursive:true,force:true});}
});
