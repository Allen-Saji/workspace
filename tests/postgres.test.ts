import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { supabaseRepository } from '../src/storage/supabase-repository.ts';

// Actual embedded Postgres SQL/RLS execution, NOT a hosted Supabase test.
// Only auth.users/auth.uid/auth.jwt and JWT claims delivery are synthetic here.
const alice='11111111-1111-4111-8111-111111111111', bob='22222222-2222-4222-8222-222222222222';
const migration=readFileSync(new URL('../supabase/migrations/20261023132335_workspace_owner_isolation.sql',import.meta.url),'utf8');
const fixture=JSON.parse(readFileSync(new URL('../fixtures/checkpoint.sample.json',import.meta.url),'utf8'));

test('embedded Postgres migration, RLS and atomic operation contract', async t => {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid not null);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      grant usage on schema auth to authenticated,anon;
      insert into auth.users values ('${alice}'),('${bob}');
      insert into auth.sessions values ('${alice}','${alice}'),('${bob}','${bob}'),('33333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333');`);
    await db.exec(migration);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261023172249_connection_persistence_candidate.sql',import.meta.url),'utf8'));
    await db.query('insert into workspace_private.workspaces(owner_id) values($1),($2)',[alice,bob]);
    async function user(id:string, anonymous=false) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({is_anonymous:anonymous,session_id:id})]);
      await db.exec('set role authenticated');
    }
    const allowed=new Set(['workspace_snapshot','workspace_mutate','workspace_ingest','workspace_receipt']);
    const repository=supabaseRepository({ async rpc(name,args={}) {
      assert.ok(allowed.has(name));
      const values=Object.values(args);
      try {
        const result=await db.query<{result:unknown}>(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) as result`,values.map(v=>typeof v==='string'?v:JSON.stringify(v)));
        return {data:result.rows[0].result,error:null};
      } catch(e) {return {data:null,error:{message:(e as Error).message}};}
    }});
    await user(alice);
    await t.test('connection schema candidate hides token hashes and isolates owner metadata',async()=>{
      await db.exec('reset role');
      await db.query(`insert into workspace_private.agent_connections(workspace_id,display_name,requested_scopes,status,setup_challenge,setup_expires_at)
        select id,'SAMPLE candidate',array['reports:append'],'pending',repeat('a',43),now()+interval '10 minutes' from workspace_private.workspaces where owner_id=$1`,[alice]);
      await user(alice);
      assert.equal((await db.query('select id,display_name from workspace_private.agent_connections')).rows.length,1);
      await assert.rejects(db.query('select setup_challenge from workspace_private.agent_connections'),/permission denied/);
      await assert.rejects(db.query('select * from workspace_private.agent_token_hashes'),/permission denied/);
      await assert.rejects(db.query('select * from workspace_private.agent_pairings'),/permission denied/);
      await assert.rejects(db.query("update workspace_private.agent_connections set status='approved'"),/permission denied/);
      await user(bob);assert.equal((await db.query('select id from workspace_private.agent_connections')).rows.length,0);
      await user(alice);
    });
    await t.test('owner cannot write tables directly or impersonate another workspace',async()=>{
      await assert.rejects(db.query("insert into workspace_private.records values(gen_random_uuid(),'x','{}')"),/permission denied/);
      await assert.rejects(repository.mutate({id:'x',kind:'note',expectedRevision:0,data:{title:'a',content:'b'},workspaceId:bob}),/unknown_field/);
      const rows=await db.query('select owner_id from workspace_private.workspaces');
      assert.deepEqual(rows.rows,[{owner_id:alice}]);
    });
    const task={id:'task',kind:'task',expectedRevision:0,data:{title:'SAMPLE task',dueDate:'',status:'ready'}};
    await t.test('mutations validate state, record revisions and history',async()=>{
      // Direct Data API callers can submit numbers outside JavaScript's safe range.
      for (const revision of ['9223372036854775808','9007199254740991']) {
        const raw=JSON.stringify(task).replace('"expectedRevision":0', '"expectedRevision":'+revision);
        await assert.rejects(db.query('select public.workspace_mutate($1)',[raw]),/invalid_revision/);
      }
      const first=await repository.mutate(task); assert.equal(first.revision,1);
      await assert.rejects(repository.mutate(task),/revision_conflict/);
      await assert.rejects(repository.mutate({...task,id:'bad',data:{...task.data,dueDate:'2026-02-31'}}),/invalid_date/);
      await assert.rejects(repository.mutate({id:'lesson',kind:'lesson',expectedRevision:0,data:{title:'SAMPLE',status:'completed',evidence:''}}),/invalid_text/);
      const next=await repository.mutate({...task,expectedRevision:1,data:{...task.data,status:'done'}});
      assert.equal(next.data.completionSource,'owner_self_report');
      const history=await db.query('select revision from workspace_private.history where id=$1 order by revision',['task']);
      assert.equal(history.rows.length,2);
    });
    let saved:Awaited<ReturnType<typeof repository.ingest>>;
    await t.test('report receipt is stable across retry and altered replay rejects',async()=>{
      saved=await repository.ingest(fixture);
      const dup=await repository.ingest(fixture);
      assert.equal(dup.receiptId,saved.receiptId); assert.equal(dup.committedAt,saved.committedAt); assert.equal(dup.status,'duplicate');
      assert.deepEqual(await repository.receipt(fixture.eventId),saved);
      await assert.rejects(repository.ingest({...fixture,summary:'changed'}),/idempotency_conflict/);
      assert.equal(saved.remotePersistence,'not_verified');
    });
    await t.test('capture collision rolls back whole report, including earlier inserts',async()=>{
      const report={...fixture,eventId:'conflict',captures:[{...fixture.captures[0],captureId:'new-before-conflict'},fixture.captures[0]]};
      await assert.rejects(repository.ingest(report),/capture_conflict/);
      assert.equal(await repository.receipt('conflict'),null);
      assert.ok(!(await repository.snapshot()).records.some(r=>r.id==='new-before-conflict'));
    });
    await t.test('correction preserves original report and never asserts remote sync',async()=>{
      const id=fixture.captures[0].captureId;
      const changed=await repository.mutate({id,kind:'capture',expectedRevision:1,data:{content:'SAMPLE corrected',userAccepted:true,disposition:'accepted'}});
      assert.equal(changed.data.correctedLocally,true); assert.equal(changed.data.remoteAcknowledgement,'not_exposed');
      assert.equal(changed.data.userAccepted,true); assert.equal(changed.data.workspaceSaved,true);
      const snapshot=await repository.snapshot();
      assert.equal(snapshot.reports[0].report.captures[0].content,fixture.captures[0].content);
      await assert.rejects(repository.mutate({id,kind:'capture',expectedRevision:2,data:{content:'x',userAccepted:false,disposition:'accepted'}}),/inconsistent_acceptance/);
    });
    await t.test('test registration does not grant access and closed states cannot reopen',async()=>{
      const c={id:'reg',kind:'registration',expectedRevision:0,data:{displayName:'SAMPLE',status:'pending',requestedScopes:['reports:append']}};
      assert.equal((await repository.mutate(c)).data.credentialIssued,false);
      await repository.mutate({...c,expectedRevision:1,data:{...c.data,status:'rejected'}});
      await assert.rejects(repository.mutate({...c,expectedRevision:2,data:{...c.data,status:'approved_for_local_test'}}),/registration_closed/);
      await assert.rejects(repository.mutate({...c,id:'scope',data:{...c.data,requestedScopes:['context:read']}}),/invalid_enum/);
    });
    await t.test('direct RPC callers cannot bypass report schema or choose owner',async()=>{
      const malicious={...fixture,eventId:'bad-direct',workspaceId:bob};
      await assert.rejects(db.query('select public.workspace_ingest($1)',[JSON.stringify(malicious)]),/invalid_schema/);
      await assert.rejects(db.query('select public.workspace_ingest($1)',[JSON.stringify({...fixture,eventId:'bad-source',source:{...fixture.source,conversationRef:'secret'}})]),/invalid_schema/);
    });
    await t.test('second owner sees no first-owner records, history or receipts; IDs are isolated',async()=>{
      await user(bob);
      const snapshot=await repository.snapshot(); assert.equal(snapshot.records.length,0); assert.equal(snapshot.reports.length,0);
      assert.equal(await repository.receipt(fixture.eventId),null);
      assert.equal((await db.query('select * from workspace_private.history')).rows.length,0);
      const second=await repository.ingest(fixture); assert.notEqual(second.receiptId,saved.receiptId);
      await user(alice); assert.equal((await repository.receipt(fixture.eventId))?.receiptId,saved.receiptId);
    });
    await t.test('anonymous, missing identity and unprovisioned identities fail closed',async()=>{
      await user(alice,true); await assert.rejects(repository.snapshot(),/auth_required/);
      await user(''); await assert.rejects(repository.snapshot(),/auth_required/);
      await user('33333333-3333-4333-8333-333333333333'); await assert.rejects(repository.snapshot(),/workspace_not_provisioned/);
      await db.exec('reset role; set role anon');
      await assert.rejects(db.query('select public.workspace_snapshot()'),/permission denied/);
    });
    await t.test('deleted session cannot read or mutate even with previously valid identity claims',async()=>{
      await db.exec('reset role');
      await db.query('delete from auth.sessions where user_id=$1',[alice]);
      await user(alice);
      await assert.rejects(repository.snapshot(),/auth_required/);
      await assert.rejects(repository.mutate({...task,id:'after-signout'}),/auth_required/);
      assert.equal((await db.query('select * from workspace_private.records')).rows.length,0);
    });
  } finally {await db.close();}
});
