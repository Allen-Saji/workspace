import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {CommandReceipt} from '../src/domain/commands.ts';
import type {WorkspaceRecord} from '../src/domain/contracts.ts';
import {PGlite} from '@electric-sql/pglite';
import {deterministicInterpreter as parser} from '../src/domain/interpreter.ts';
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
test('embedded Postgres command ledger: owner isolation, atomicity, retries and undo',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid);
 create function auth.uid() returns uuid language sql stable as $$ select current_setting('request.jwt.claim.sub',true)::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
 grant usage on schema auth to authenticated,anon;
 insert into auth.users values ('${alice}'),('${bob}');insert into auth.sessions values ('${alice}','${alice}'),('${bob}','${bob}');`);
 for(const name of ['20261023132335_workspace_owner_isolation.sql','20261023174135_command_transactions.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.query('insert into workspace_private.workspaces(owner_id) values($1),($2)',[alice,bob]);
 async function user(id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({session_id:id,is_anonymous:false})]);await db.exec('set role authenticated');}
 async function call<T=CommandReceipt>(name:string,value?:unknown){const r=await db.query<{r:T}>(`select public.workspace_command_${name}(${value===undefined?'':'$1'}) r`,value===undefined?[]:[typeof value==='string'?value:JSON.stringify(value)]);return r.rows[0].r;}
 await user(alice);
 const p=parser.propose('task: SAMPLE\nnote: SAMPLE | text');p.operations[1].data.content='';
 await assert.rejects(call('apply',p),/invalid_text/);assert.equal((await call<CommandReceipt[]>('history')).length,0);assert.equal((await db.query('select * from workspace_private.records')).rows.length,0);
 p.operations[1].data.content='valid';const r=await call('apply',p);assert.equal(r.changes.length,2);assert.deepEqual(await call('apply',p),r);
 await assert.rejects(call('apply',{...p,timezone:'UTC'}),/invalid_schema/);
 await assert.rejects(call('apply',{...p,operations:[p.operations[0]]}),/idempotency_conflict/);
 await assert.rejects(db.query("delete from workspace_private.commands"),/permission denied/);
 await user(bob);assert.equal(await call('receipt',p.commandId),null);assert.equal((await call<CommandReceipt[]>('history')).length,0);assert.equal((await db.query('select * from workspace_private.commands')).rows.length,0);await assert.rejects(call('undo',p.commandId),/unknown_command/);
 await user(alice);
 const op=p.operations[0];const edit=parser.propose('task: SAMPLE edited');edit.operations[0]={...op,expectedRevision:1,data:{...op.data,title:'edited'}};
 // Concurrent submissions are queued by embedded Postgres. Live multi-connection
 // lock contention still requires ordinary hosted sessions and is NOT claimed.
 const results=await Promise.allSettled([call('apply',edit),call('apply',{...edit,commandId:crypto.randomUUID()})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
 await assert.rejects(call('undo',p.commandId),/revision_conflict/);
 const u=await call('undo',edit.commandId);assert.ok(u.undo);assert.deepEqual(await call('undo',edit.commandId),u);
 const current=(await db.query<{body:WorkspaceRecord}>('select body from workspace_private.records where id=$1',[op.id])).rows[0].body;assert.equal(current.revision,3);assert.equal(current.data.title,'SAMPLE');
 const fresh=parser.propose('meeting: SAMPLE | 2026-10-25 09:00 | 2026-10-25 09:30');await call('apply',fresh);await call('undo',fresh.commandId);assert.equal((await db.query('select * from workspace_private.records where id=$1',[fresh.operations[0].id])).rows.length,0);
 const old=parser.propose('task: expired');await call('apply',old);await db.exec('reset role');await db.query("update workspace_private.commands set body=jsonb_set(body,'{committedAt}','\"2000-01-01T00:00:00Z\"') where id=$1",[old.commandId]);await user(alice);await assert.rejects(call('undo',old.commandId),/undo_expired/);
 await db.exec('reset role;set role anon');await assert.rejects(call<CommandReceipt[]>('history'),/permission denied/);
 }finally{await db.close();}
});
