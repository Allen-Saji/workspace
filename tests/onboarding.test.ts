import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {initializeOwnWorkspace} from '../src/server/onboarding.ts';
const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
test('disabled onboarding never calls Auth/RPC; enabled path verifies identity and passes no owner arguments',async()=>{
 let authCalls=0,rpcCalls=0;
 const client={auth:{getUser:async()=>{authCalls++;return {data:{user:{id:alice}},error:null};}},rpc:async(name:string,args?:Record<string,unknown>)=>{rpcCalls++;assert.equal(name,'workspace_ensure_own');assert.equal(args,undefined);return {data:{workspaceId:'synthetic'},error:null};}};
 await initializeOwnWorkspace(client,false);assert.equal(authCalls,0);assert.equal(rpcCalls,0);
 await initializeOwnWorkspace(client,true);assert.equal(authCalls,1);assert.equal(rpcCalls,1);
 await assert.rejects(initializeOwnWorkspace({...client,auth:{getUser:async()=>({data:{user:null},error:null})}},true),/auth_required/);assert.equal(rpcCalls,1);
});
test('candidate self-onboarding requires confirmed live identity and isolates owners; queued retries converge',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz);create table auth.sessions(id uuid primary key,user_id uuid);
 create function auth.uid() returns uuid language sql stable as $$ select current_setting('request.jwt.claim.sub',true)::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb $$;
 grant usage on schema auth to authenticated,anon;
 insert into auth.users values ('${alice}',now()),('${bob}',null);insert into auth.sessions values ('${alice}','${alice}'),('${bob}','${bob}');`);
 for(const name of ['20261023132335_workspace_owner_isolation.sql','20261023175600_self_workspace_candidate.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 async function user(id:string,anonymous=false){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({session_id:id,is_anonymous:anonymous,user_metadata:{owner_id:alice,email_confirmed:true}})]);await db.exec('set role authenticated');}
 async function ensure(){return (await db.query<{r:{workspaceId:string}}>('select public.workspace_ensure_own() r')).rows[0].r.workspaceId;}
 await user(bob);await assert.rejects(ensure(),/email_confirmation_required/);assert.equal((await db.query('select * from workspace_private.workspaces')).rows.length,0);
 await user(alice);const ids=await Promise.all([ensure(),ensure(),ensure()]);assert.equal(new Set(ids).size,1);assert.equal((await db.query('select * from workspace_private.workspaces')).rows.length,1);
 await assert.rejects(db.query('select public.workspace_ensure_own($1)',[bob]),/does not exist/);
 await assert.rejects(db.query('update workspace_private.workspaces set owner_id=$1',[bob]),/permission denied/);
 await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[bob]);
 await user(bob);const b=await ensure();assert.notEqual(b,ids[0]);assert.deepEqual((await db.query('select owner_id from workspace_private.workspaces')).rows,[{owner_id:bob}]);
 await user(alice,true);await assert.rejects(ensure(),/auth_required/);
 await db.exec('reset role');await db.query('delete from auth.sessions where user_id=$1',[alice]);await user(alice);await assert.rejects(ensure(),/auth_required/);
 await db.exec('reset role;set role anon');await assert.rejects(ensure(),/permission denied/);
 await db.exec('reset role');assert.equal((await db.query('select * from workspace_private.workspaces')).rows.length,2);
 }finally{await db.close();}
});
