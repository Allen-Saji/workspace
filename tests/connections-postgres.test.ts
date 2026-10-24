import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {hostedConnections} from '../src/connections/hosted.ts';
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
const hash=(s:string)=>createHash('sha256').update(s).digest('base64url');
const fixture=JSON.parse(readFileSync(new URL('../fixtures/checkpoint.sample.json',import.meta.url),'utf8'));
const migrations=['20261023132335_workspace_owner_isolation.sql','20261023172249_connection_persistence_candidate.sql','20261024082058_hosted_connection_transactions_candidate.sql','20261024084829_agent_diary_v2_candidate.sql'];
test('hosted connection candidate: real embedded SQL, synthetic Auth only',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'workspace-agent-pg-'));let db=new PGlite(dir,{extensions:{pgcrypto}});
 const invoke=async(name:string,args:Record<string,unknown>={})=>{const values=Object.values(args);const r=await db.query<{result:Record<string,unknown>}>(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) result`,values.map(v=>v&&typeof v==='object'?JSON.stringify(v):v));return r.rows[0].result;};
 const client=hostedConnections({async rpc(name,args){try{return {data:await invoke(name,args),error:null};}catch{return {data:null,error:{message:'database error'}};}}});
 async function user(id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({session_id:id,is_anonymous:false})]);await db.exec('set role authenticated');}
 async function agent(){await db.exec("reset role; select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false); set role anon");}
 async function control(action:string,id?:string,scopes?:string[]){return client.control({action,...(id?{id}:{}),...(scopes?{scopes}:{})});}
 async function register(scopes=['reports:append','captures:append','receipts:read']){
  await user(alice);const pair=await control('pair');const verifier=randomBytes(32).toString('base64url');
  const input={pairingCode:pair.pairingCode,requestId:randomBytes(12).toString('hex'),displayName:'SYNTHETIC agent',requestedScopes:scopes,codeChallenge:hash(verifier),codeChallengeMethod:'S256'};
  await agent();const registered=await client.transport('registrations',null,input);return {pair,verifier,input,id:String(registered.id)};
 }
 async function approved(scopes?:string[]){const r=await register(scopes);await user(alice);await control('approve',r.id,scopes??r.input.requestedScopes);await agent();const x=await client.transport('exchange',null,{registrationId:r.id,codeVerifier:r.verifier});return {...r,token:String(x.accessToken)};}
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);create table auth.sessions(id uuid primary key,user_id uuid);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  grant usage on schema auth to anon,authenticated;
  insert into auth.users values('${alice}',now()),('${bob}',now());insert into auth.sessions values('${alice}','${alice}'),('${bob}','${bob}');`);
  for(const m of migrations)await db.exec(readFileSync(new URL('../supabase/migrations/'+m,import.meta.url),'utf8'));
  await db.query('insert into workspace_private.workspaces(owner_id) values($1),($2)',[alice,bob]);
  await t.test('candidate exposes no execution; activation independently denies even with fixture grants',async()=>{
   await user(alice);await assert.rejects(invoke('workspace_agent_control',{command:{action:'pair'}}),/permission denied/);
   await db.exec('reset role; grant usage on schema workspace_private to anon; grant execute on function workspace_private.agent_rpc(text,text,jsonb,boolean) to anon,authenticated; grant execute on function public.workspace_agent_control(jsonb) to authenticated; grant execute on function public.workspace_agent_transport(text,text,jsonb) to anon;');
   await user(alice);await assert.rejects(control('pair'),/connections_disabled/);
   await db.exec('reset role; update workspace_private.agent_activation set enabled=true');
  });
  await t.test('atomic pairing replay, scope approval and one-time proof exchange',async()=>{
   const r=await register();const results=await Promise.all([client.transport('registrations',null,r.input),client.transport('registrations',null,r.input)]);assert.equal(results[0].id,r.id);assert.equal(results[1].id,r.id);
   await assert.rejects(client.transport('registrations',null,{...r.input,displayName:'changed'}),/idempotency_conflict/);
   assert.equal((await client.transport('exchange',null,{registrationId:r.id,codeVerifier:r.verifier})).status,'pending');
   await user(bob);await assert.rejects(control('approve',r.id,['reports:append']),/scope_denied/);assert.deepEqual((await control('list')).connections,[]);
   await user(alice);await assert.rejects(control('approve',r.id,['context:read']),/scope_denied/);await control('approve',r.id,['reports:append']);
   await agent();await assert.rejects(client.transport('exchange',null,{registrationId:r.id,codeVerifier:'x'.repeat(43)}),/auth_required/);
   const outcomes=await Promise.allSettled([client.transport('exchange',null,{registrationId:r.id,codeVerifier:r.verifier}),client.transport('exchange',null,{registrationId:r.id,codeVerifier:r.verifier})]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
   const token=String((outcomes.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<Record<string,unknown>>).value.accessToken);
   await assert.rejects(client.transport('events',token,fixture),/scope_denied/);await assert.rejects(client.transport('receipts',token,{eventId:'x'}),/scope_denied/);
  });
  let active:Awaited<ReturnType<typeof approved>>;let receipt:Record<string,unknown>;
  await t.test('scoped reports atomically persist; duplicate and altered-payload retry are distinguished',async()=>{
   active=await approved();receipt=await client.transport('events',active.token,fixture);
   assert.equal(receipt.remotePersistence,'not_verified');
   const replay=await client.transport('events',active.token,fixture);assert.equal(replay.status,'duplicate');assert.equal(replay.receiptId,receipt.receiptId);
   await assert.rejects(client.transport('events',active.token,{...fixture,summary:'altered'}),/idempotency_conflict/);
   await assert.rejects(client.transport('events',active.token,{...fixture,eventId:'probe',entityRefs:['owner-task']}),/scope_denied/);
   const collision={...fixture,eventId:'rollback',captures:[{...fixture.captures[0],captureId:'new-before-conflict'},fixture.captures[0]]};
   await assert.rejects(client.transport('events',active.token,collision),/capture_conflict/);
   assert.equal((await client.transport('receipts',active.token,{eventId:'rollback'})).receipt,null);
   await user(alice);const snap=await invoke('workspace_snapshot');const records=snap.records as {data:Record<string,unknown>}[];assert.equal(records.length,fixture.captures.length);assert.equal(records[0].data.userAccepted,false);assert.equal(records[0].data.remoteAcknowledgement,'not_exposed');
   const list=(await control('list')).connections as Record<string,unknown>[];assert.ok(list.find(x=>x.id===active.id)?.lastReportedAt);
   await user(bob);assert.deepEqual((await invoke('workspace_snapshot')).reports,[]);
  });
  await t.test('connection namespaces and receipt lookups cannot cross connection boundaries',async()=>{
   const second=await approved();assert.equal((await client.transport('receipts',second.token,{eventId:fixture.eventId})).receipt,null);
   const secondReceipt=await client.transport('events',second.token,fixture);assert.notEqual(secondReceipt.receiptId,receipt.receiptId);assert.notDeepEqual(secondReceipt.records,receipt.records);
   await user(alice);await assert.rejects(db.query('select * from workspace_private.agent_token_hashes'),/permission denied/);await assert.rejects(db.query('select setup_challenge from workspace_private.agent_connections'),/permission denied/);
  });
  await t.test('restart persistence, hash-only credential storage, rotation and revocation',async()=>{
   await db.exec('reset role');const hashes=await db.query<{token_hash:string}>('select token_hash from workspace_private.agent_token_hashes');assert.ok(hashes.rows.some(x=>x.token_hash===hash(active.token)));assert.ok(!JSON.stringify(hashes.rows).includes(active.token));
   await db.close();db=new PGlite(dir,{extensions:{pgcrypto}});await agent();assert.deepEqual((await client.transport('receipts',active.token,{eventId:fixture.eventId})).receipt,receipt);
   const replacement=await client.transport('rotate',active.token,{});await assert.rejects(client.transport('events',active.token,fixture),/auth_required/);
   active.token=String(replacement.accessToken);assert.equal((await client.transport('events',active.token,fixture)).status,'duplicate');
   await user(alice);await control('revoke',active.id);await control('revoke',active.id);await agent();await assert.rejects(client.transport('events',active.token,fixture),/auth_required/);await assert.rejects(client.transport('receipts',active.token,{eventId:fixture.eventId}),/auth_required/);
  });
  await t.test('expired setup, direct parameter tampering and unconfirmed owners cannot gain access',async()=>{
   const r=await register();await db.exec('reset role');await db.query("update workspace_private.agent_pairings set expires_at=now()-interval '1 second' where connection_id=$1",[r.id]);
   await agent();await assert.rejects(client.transport('registrations',null,r.input),/auth_required/);
   await user(alice);await db.exec('reset role');await db.query("update workspace_private.agent_connections set setup_expires_at=now()-interval '1 second' where id=$1",[r.id]);await user(alice);await assert.rejects(control('approve',r.id,['reports:append']),/registration_closed/);
   assert.equal((await invoke('workspace_agent_control',{command:{action:'pair',owner:bob}})).error,'invalid_schema');
   await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=null where id=$1',[bob]);await user(bob);await assert.rejects(control('pair'),/auth_required/);
   await agent();assert.equal((await invoke('workspace_agent_transport',{action:null,credential:null,payload:{}})).error,'scope_denied');
  });
  await t.test('v2 diary daily uniqueness, revisions, backfill, status separation and owner isolation',async()=>{
   await db.exec('reset role; delete from workspace_private.agent_limits');
   const connection=await approved();
   await assert.rejects(invoke('workspace_agent_journal_transport',{action:'diary',credential:connection.token,payload:{}}),/permission denied/);
   await db.exec('reset role; grant execute on function workspace_private.agent_journal_rpc(text,text,jsonb),public.workspace_agent_journal_transport(text,text,jsonb) to anon; grant execute on function workspace_private.agent_journal_snapshot(),public.workspace_agent_journal() to authenticated');
   const report={schemaVersion:'2',kind:'diary',eventId:'diary-one',observedAt:'2026-01-01T19:00:00.000Z',sentAt:'2026-01-03T10:00:00.000Z',isTest:true,summary:'SYNTHETIC daily work',localDate:'2026-01-02',timezone:'Asia/Kolkata',expectedRevision:0,results:['SYNTHETIC result'],blockers:[],nextSteps:[],evidence:[]};
   const send=(action:string,payload:unknown)=>invoke('workspace_agent_journal_transport',{action,credential:connection.token,payload});
   await agent();const first=await send('diary',report);assert.equal(first.revision,1);assert.equal((await send('diary',report)).receiptId,first.receiptId);
   assert.equal((await send('diary',{...report,summary:'changed'})).error,'idempotency_conflict');assert.equal((await send('diary',{...report,eventId:'stale'})).error,'revision_conflict');
   assert.equal((await send('diary',{...report,eventId:'edit',expectedRevision:1})).revision,2);
   assert.equal((await send('diary',{...report,eventId:'zone',expectedRevision:2,timezone:'Asia/Colombo'})).error,'timezone_conflict');
   assert.equal((await send('diary',{...report,eventId:'date',localDate:'2026-01-01'})).error,'invalid_local_date');
   assert.equal((await send('diary',{...report,eventId:'backfill',localDate:'2026-01-01',observedAt:'2025-12-31T19:00:00.000Z'})).revision,1);
   const status={schemaVersion:'2',kind:'status',eventId:'status-new',observedAt:'2026-01-03T12:00:00.000Z',sentAt:'2026-01-03T13:00:00.000Z',isTest:true,summary:'SYNTHETIC working',state:'working',evidence:[]};
   assert.equal((await send('status',status)).status,'saved');assert.equal((await send('status',{...status,eventId:'status-old',observedAt:'2026-01-03T10:00:00.000Z',state:'offline'})).status,'saved');
   await user(alice);const journal=await invoke('workspace_agent_journal');assert.equal((journal.diaries as unknown[]).length,2);assert.equal((journal.statuses as {report:{state:string}}[])[0].report.state,'working');
   await user(bob);assert.deepEqual(await invoke('workspace_agent_journal'),{diaries:[],statuses:[]});
   await user(alice);await control('revoke',connection.id);await agent();assert.equal((await send('diary',report)).error,'auth_required');
  });
  await t.test('rejection, expiration, session deletion and failed-attempt budgets fail closed',async()=>{
   const r=await register();await user(alice);await control('reject',r.id);await assert.rejects(control('approve',r.id,['reports:append']),/registration_closed/);await agent();await assert.rejects(client.transport('exchange',null,{registrationId:r.id,codeVerifier:r.verifier}),/registration_closed/);
   const exp=await approved();await db.exec('reset role');await db.query("update workspace_private.agent_connections set token_expires_at=now()-interval '1 second' where id=$1",[exp.id]);await agent();await assert.rejects(client.transport('events',exp.token,fixture),/auth_required/);
   await db.exec("reset role; delete from workspace_private.agent_limits where bucket='transport:exchange'");await agent();for(let i=0;i<30;i++)await assert.rejects(client.transport('exchange',null,{registrationId:r.id,codeVerifier:'x'.repeat(43)}),/auth_required/);await assert.rejects(client.transport('exchange',null,{registrationId:r.id,codeVerifier:r.verifier}),/rate_limited/);
   await db.exec('reset role');await db.query('delete from auth.sessions where user_id=$1',[alice]);await user(alice);await assert.rejects(control('pair'),/auth_required/);
  });
 }finally{await db.close();rmSync(dir,{recursive:true,force:true});}
});
