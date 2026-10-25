import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
test('assistant PostgreSQL reservations enforce approval, isolation, replay, revoked sessions and global cap',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid);
 create function auth.uid() returns uuid language sql stable as $$ select current_setting('request.jwt.claim.sub',true)::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
 grant usage on schema auth to authenticated,anon;
 insert into auth.users values ('${alice}'),('${bob}');insert into auth.sessions values ('${alice}','${alice}'),('${bob}','${bob}');`);
 for(const name of ['20261023132335_workspace_owner_isolation.sql','20261025065959_assistant_runtime.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.query('insert into workspace_private.workspaces(owner_id) values($1),($2)',[alice,bob]);
 async function user(id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({session_id:id,is_anonymous:false})]);await db.exec('set role authenticated');}
 async function call(id:string|null=null,digest:string|null=null,payload:string|null=null){return (await db.query<{r:{fresh:boolean;payload:string|null;usedUsd:number}}> ('select public.workspace_assistant_budget($1,$2,$3) r',[id,digest,payload])).rows[0].r;}
 await user(alice);await assert.rejects(call(),/assistant_not_enabled/);
 await db.exec('reset role;insert into workspace_private.assistant_access select id,true from workspace_private.workspaces;');
 await user(alice);const digest='a'.repeat(64);
 assert.equal((await call('request',digest)).fresh,true);assert.equal((await call('request',digest)).fresh,false);
 await call('request',digest,'sealed');assert.equal((await call('request',digest)).payload,'sealed');
 await assert.rejects(call('request','b'.repeat(64)),/idempotency_conflict/);
 await assert.rejects(db.query('delete from workspace_private.assistant_requests'),/permission denied/);
 await assert.rejects(db.query('update workspace_private.assistant_access set enabled=true'),/permission denied/);
 await user(bob);assert.equal((await call('request',digest)).fresh,true);assert.equal((await call('request',digest)).payload,null);
 for(let i=2;i<20;i++)await call('request'+i,digest);
 assert.equal((await call()).usedUsd,1);await assert.rejects(call('over',digest),/assistant_budget_exhausted/);
 await db.exec('reset role');await db.query('delete from auth.sessions where id=$1',[bob]);await user(bob);await assert.rejects(call(),/auth_required/);
 await db.exec('reset role;set role anon');await assert.rejects(call(),/permission denied/);
 }finally{await db.close();}
});
