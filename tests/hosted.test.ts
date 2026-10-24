import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeConfig } from '../src/server/config.ts';
import { requireUser } from '../src/server/supabase.ts';
import { guard, failure } from '../src/server/http.ts';
import { DomainError } from '../src/domain/contracts.ts';
import { supabaseRepository } from '../src/storage/supabase-repository.ts';

test('hosted configuration fails closed; no secret key or implicit SQLite on Vercel',()=>{
  assert.equal(runtimeConfig({}).mode,'sqlite');
  assert.equal(runtimeConfig({WORKSPACE_ORIGIN:'http://127.0.0.1:3211'}).origin,'http://127.0.0.1:3211');
  assert.throws(()=>runtimeConfig({WORKSPACE_ORIGIN:'https://public.example'}),/configuration_required/);
  assert.throws(()=>runtimeConfig({VERCEL:'1'}),/configuration_required/);
  assert.throws(()=>runtimeConfig({WORKSPACE_STORAGE:'unknown'}),/configuration_required/);
  const env={WORKSPACE_STORAGE:'supabase',WORKSPACE_ORIGIN:'https://workspace.example',SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic'};
  assert.equal(runtimeConfig(env).mode,'supabase');
  assert.equal(runtimeConfig({...env,VERCEL:'1'}).mode,'supabase');
  assert.throws(()=>runtimeConfig({...env,VERCEL:'1',WORKSPACE_ORIGIN:'http://127.0.0.1:3212'}),/configuration_required/);
  for(const change of [{SUPABASE_PUBLISHABLE_KEY:'sb_secret_not_allowed'},{WORKSPACE_ORIGIN:'https://workspace.example/path'},{WORKSPACE_ORIGIN:'http://public.example'},{SUPABASE_URL:'http://synthetic.supabase.co'}]) assert.throws(()=>runtimeConfig({...env,...change}),/configuration_required/);
});
test('server authentication requires verified nonanonymous user, not metadata',async()=>{
  assert.equal(await requireUser({auth:{async getUser(){return {data:{user:{id:'owner'}},error:null};}}}),'owner');
  for(const result of [{data:{user:null},error:null},{data:{user:{id:'owner',is_anonymous:true}},error:null},{data:{user:{id:'owner'}},error:new Error('expired')}]) await assert.rejects(requireUser({auth:{async getUser(){return result;}}}),/auth_required/);
});
test('hosted mutation origin guard rejects cross-origin and spoofed forwarded host',()=>{
  const request=(headers:Record<string,string>)=>new Request('https://internal/',{headers});
  const good={host:'workspace.example',origin:'https://workspace.example','x-workspace-request':'local-ui','content-type':'application/json'};
  assert.doesNotThrow(()=>guard(request(good),true,'https://workspace.example'));
  assert.throws(()=>guard(request({...good,origin:'https://evil.example'}),true,'https://workspace.example'),/origin_denied/);
  assert.throws(()=>guard(request({...good,host:'evil.example','x-forwarded-host':'workspace.example'}),true,'https://workspace.example'),/host_denied/);
  assert.equal(failure(new DomainError('auth_required')).status,401);
  assert.match(failure(new DomainError('auth_required')).headers.get('cache-control')! ,/no-store/);
});
test('hosted adapter rejects caller workspace selection before RPC and hides backend error details',async()=>{
  let calls=0;
  const db=supabaseRepository({async rpc(){calls++;return {data:null,error:{message:'connection string private backend detail'}};}});
  await assert.rejects(db.mutate({workspaceId:'other'}),/unknown_field/);
  assert.equal(calls,0);
  await assert.rejects(db.snapshot(),/^Error: storage_unavailable$/);
});
