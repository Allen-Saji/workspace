import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { TestConnections, SCOPES } from '../src/connections/service.ts';
import { enabled, handle } from '../src/connections/http.ts';
const verifier=()=>randomBytes(32).toString('base64url');
const challenge=(v:string)=>createHash('sha256').update(v).digest('base64url');
const report={schemaVersion:'1',eventId:'test-event',checkpointId:'test-checkpoint',eventType:'checkpoint_reported',occurredAt:'2026-01-01T00:00:00Z',reportingMode:'explicit_checkpoint',isTest:true,summary:'SAMPLE isolated connection test',source:{conversationRef:null,segmentRef:null,availability:'not_exposed'},entityRefs:[],captures:[]};
function register(db:TestConnections, owner='alice', workspace='a', requestedScopes:readonly string[]=SCOPES){
  const codeVerifier=verifier();
  const request={pairingCode:db.pair(owner,workspace).pairingCode,requestId:crypto.randomUUID(),displayName:'SAMPLE test client',requestedScopes,codeChallenge:challenge(codeVerifier),codeChallengeMethod:'S256'};
  const registration=db.register(request); return {request,registration,codeVerifier};
}
function connect(db:TestConnections, owner='alice', workspace='a', scopes:readonly string[]=SCOPES){
  const x=register(db,owner,workspace,scopes);db.decide(owner,workspace,x.registration.id,'approve',scopes);
  const issued=db.exchange({registrationId:x.registration.id,codeVerifier:x.codeVerifier});
  assert.ok('accessToken' in issued);return {...x,token:issued.accessToken!};
}
test('pairing is atomic, idempotent and bound to owner and PKCE proof',()=>{
  const db=new TestConnections();try{
    const x=register(db);
    assert.equal(db.register(x.request).id,x.registration.id);
    assert.throws(()=>db.register({...x.request,displayName:'altered'}),/idempotency_conflict/);
    assert.throws(()=>db.register({...x.request,requestId:'other'}),/idempotency_conflict/);
    assert.throws(()=>db.decide('bob','a',x.registration.id,'approve',SCOPES),/scope_denied/);
    assert.throws(()=>db.decide('alice','b',x.registration.id,'approve',SCOPES),/scope_denied/);
    assert.throws(()=>db.exchange({registrationId:x.registration.id,codeVerifier:verifier()}),/auth_required/);
    assert.equal(db.exchange({registrationId:x.registration.id,codeVerifier:x.codeVerifier}).status,'pending');
    db.decide('alice','a',x.registration.id,'approve',['reports:append']);
    const issued=db.exchange({registrationId:x.registration.id,codeVerifier:x.codeVerifier});
    assert.ok('accessToken' in issued);
    assert.throws(()=>db.exchange({registrationId:x.registration.id,codeVerifier:x.codeVerifier}),/registration_closed/);
    assert.ok(!JSON.stringify(db.list('alice','a')).includes(issued.accessToken!));
    assert.deepEqual(db.list('bob','a'),[]);
  }finally{db.close();}
});
test('scoped ingestion and own receipts; changed replay denied; revoke blocks even duplicates',()=>{
  const db=new TestConnections();try{
    const a=connect(db), b=connect(db,'alice','a'), c=connect(db,'bob','b');
    const saved=db.ingest(a.token,report);
    assert.equal(db.ingest(a.token,report).receiptId,saved.receiptId);
    assert.equal(db.ingest(a.token,report).status,'duplicate');
    assert.throws(()=>db.ingest(a.token,{...report,summary:'changed'}),/idempotency_conflict/);
    assert.equal(db.receipt(b.token,report.eventId),null);assert.equal(db.receipt(c.token,report.eventId),null);
    assert.notEqual(db.ingest(b.token,report).receiptId,saved.receiptId);
    assert.throws(()=>db.ingest(a.token,{...report,isTest:false}),/test_only/);
    assert.throws(()=>db.ingest(a.token,{...report,workspaceId:'b'}),/unknown_field/);
    assert.throws(()=>db.ingest(a.token,{...report,entityRefs:['private-note']}),/scope_denied/);
    db.decide('alice','a',a.registration.id,'revoke');
    assert.throws(()=>db.ingest(a.token,report),/auth_required/);assert.throws(()=>db.receipt(a.token,report.eventId),/auth_required/);
    assert.throws(()=>db.decide('alice','a',a.registration.id,'approve',SCOPES),/registration_closed/);
    assert.ok(db.receipt(b.token,report.eventId));
  }finally{db.close();}
});
test('scope narrowing, expiry, rejection and no automatic access from approval',()=>{
  let now=Date.now();const db=new TestConnections(()=>now);try{
    const x=register(db,'alice','a',['reports:append']);
    assert.throws(()=>db.decide('alice','a',x.registration.id,'approve',SCOPES),/scope_denied/);
    db.decide('alice','a',x.registration.id,'reject');
    assert.throws(()=>db.exchange({registrationId:x.registration.id,codeVerifier:x.codeVerifier}),/registration_closed/);
    const narrow=connect(db,'alice','a',['reports:append']);
    assert.throws(()=>db.receipt(narrow.token,'x'),/scope_denied/);
    assert.throws(()=>db.ingest(narrow.token,{...report,captures:[{captureId:'c',revision:1,type:'fact',content:'SAMPLE',basis:'explicit',disposition:'proposed',sensitivity:'ordinary',remotePersistence:'not_exposed'}]}),/scope_denied/);
    const pending=register(db);now+=600001;
    assert.throws(()=>db.register(pending.request),/auth_required/);
    assert.throws(()=>db.decide('alice','a',pending.registration.id,'approve',SCOPES),/registration_closed/);
    now+=3600000;assert.throws(()=>db.ingest(narrow.token,report),/auth_required/);
  }finally{db.close();}
});
test('capture collisions roll back whole event; connection namespaces prevent interference',()=>{
  const db=new TestConnections();try{
    const a=connect(db),b=connect(db);
    const capture={captureId:'c',revision:1,type:'fact',content:'SAMPLE',basis:'explicit',disposition:'proposed',sensitivity:'ordinary',remotePersistence:'not_exposed'};
    const first=db.ingest(a.token,{...report,captures:[capture]});
    const second=db.ingest(b.token,{...report,captures:[capture]});
    assert.notEqual(first.records[0].id,second.records[0].id);
    assert.throws(()=>db.ingest(a.token,{...report,eventId:'collision',captures:[{...capture,captureId:'new'},capture]}),/capture_conflict/);
    assert.equal(db.receipt(a.token,'collision'),null);
    assert.equal(db.ingest(a.token,{...report,eventId:'after',captures:[{...capture,captureId:'new'}]}).status,'saved');
  }finally{db.close();}
});
test('failed setup requests consume rate budget; disabled gate cannot open hosted or personal storage',async()=>{
  const db=new TestConnections();try{
    for(let i=0;i<30;i++)assert.throws(()=>db.register({}),/invalid_text/);
    assert.throws(()=>db.register({}),/rate_limited/);
  }finally{db.close();}
  assert.equal(enabled({}),false);
  assert.equal(enabled({WORKSPACE_CONNECTIONS:'ephemeral-test'}),true);
  assert.equal(enabled({WORKSPACE_CONNECTIONS:'ephemeral-test',VERCEL:'1'}),false);
  const response=await handle(new Request('http://127.0.0.1:3210/api/agent/v1/control',{headers:{host:'127.0.0.1:3210'}}),'control');
  assert.equal(response.status,503);
  assert.match(response.headers.get('cache-control')!,/no-store/);
});
test('HTTP boundary enforces owner CSRF, agent bearer and revocation',async()=>{
  const previous=process.env.WORKSPACE_CONNECTIONS;
  process.env.WORKSPACE_CONNECTIONS='ephemeral-test';
  const call=(path:string,body:unknown,headers:Record<string,string>={})=>handle(new Request('http://127.0.0.1:3210/api/agent/v1/'+path,{method:'POST',headers:{host:'127.0.0.1:3210','content-type':'application/json',...headers},body:JSON.stringify(body)}),path);
  const ownerHeaders={origin:'http://127.0.0.1:3210','x-workspace-request':'local-ui'};
  try{
    assert.equal((await call('control',{action:'pair'})).status,403);
    const pairing=await (await call('control',{action:'pair'},ownerHeaders)).json();
    const codeVerifier=verifier();
    const registration=await (await call('registrations',{pairingCode:pairing.pairingCode,requestId:'http-test',displayName:'SAMPLE HTTP client',requestedScopes:SCOPES,codeChallenge:challenge(codeVerifier),codeChallengeMethod:'S256'})).json();
    assert.equal((await call('control',{action:'approve',id:registration.id,scopes:SCOPES},ownerHeaders)).status,200);
    const issued=await (await call('exchange',{registrationId:registration.id,codeVerifier})).json();
    const agentHeaders={authorization:'Bearer '+issued.accessToken};
    assert.equal((await call('events',report)).status,401);
    assert.equal((await call('events',report,{...agentHeaders,cookie:'untrusted=1'})).status,403);
    assert.equal((await call('events',report,agentHeaders)).status,200);
    assert.equal((await call('receipts',{eventId:report.eventId},agentHeaders)).status,200);
    assert.equal((await call('control',{action:'revoke',id:registration.id},ownerHeaders)).status,200);
    assert.equal((await call('events',report,agentHeaders)).status,401);
  }finally{if(previous===undefined)delete process.env.WORKSPACE_CONNECTIONS;else process.env.WORKSPACE_CONNECTIONS=previous;}
});
