import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedJson, guard } from '../src/server/http.ts';
const origin='http://127.0.0.1:3210';
function request(headers: Record<string,string> = {}) {return new Request(origin+'/api/workspace',{method:'POST',headers:{host:'127.0.0.1:3210',origin,'content-type':'application/json','x-workspace-request':'local-ui',...headers},body:'{}'});}
test('host/origin/custom header protections reject cross-site and DNS rebinding requests',()=>{
  guard(request(),true);
  assert.throws(()=>guard(request({host:'attacker.example'}),true),/host_denied/);
  assert.throws(()=>guard(request({origin:'https://attacker.example'}),true),/origin_denied/);
  assert.throws(()=>guard(request({'sec-fetch-site':'cross-site'}),true),/origin_denied/);
  assert.throws(()=>guard(request({'x-workspace-request':''}),true),/csrf_denied/);
  assert.throws(()=>guard(request({'content-type':'text/plain'}),true),/csrf_denied/);
  assert.throws(()=>guard(request({origin:''}),true),/csrf_denied/);
});
test('bounded stream rejects oversized request even without Content-Length',async()=>{
  const large=new Request(origin,{method:'POST',body:'a'.repeat(65537)});
  await assert.rejects(()=>boundedJson(large),/payload_too_large/);
  assert.deepEqual(await boundedJson(request()),{});
});
