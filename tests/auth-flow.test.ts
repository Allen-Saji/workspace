import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationCode,completeConfirmation,requestSignup} from '../src/server/auth-flow.ts';
const origin='http://127.0.0.1:3212';
function request(query:string,host='127.0.0.1:3212'){return new Request(origin+'/auth/callback'+query,{headers:{host}});}
test('confirmation callbacks reject missing, duplicate, failed and redirect-injection parameters',()=>{
 for(const q of ['', '?error=denied','?code=a&code=b','?code=a&next=https://evil.test','?code=a&redirect_to=//evil.test','?code=%0Ainvalid'])assert.throws(()=>confirmationCode(request(q),origin));
 assert.throws(()=>confirmationCode(request('?code=synthetic','evil.test'),origin),/host_denied/);
 assert.equal(confirmationCode(request('?code=synthetic-fixture'),origin),'synthetic-fixture');
});
test('signup fixture uses fixed callback, preserves confirmation and never retries a failed request',async()=>{
 let calls=0;let fail=false;
 const client={auth:{signUp:async(input:{options:{emailRedirectTo:string}})=>{calls++;assert.equal(input.options.emailRedirectTo,origin+'/auth/callback');return {error:fail?new Error('synthetic failure'):null};}}};
 await assert.rejects(requestSignup(client,'synthetic@example.invalid','short',origin),/password_too_short/);assert.equal(calls,0);
 await requestSignup(client,'synthetic@example.invalid','synthetic-fixture-only',origin);assert.equal(calls,1);
 fail=true;await assert.rejects(requestSignup(client,'synthetic@example.invalid','synthetic-fixture-only',origin),/signup_unavailable/);assert.equal(calls,2);
});
test('confirmation exchanges once and refuses interrupted or unverified sessions',async()=>{
 let exchanges=0;
 const auth={exchangeCodeForSession:async()=>{exchanges++;return {error:null as unknown};},getUser:async()=>({data:{user:{id:'synthetic',is_anonymous:false}},error:null as unknown})};
 await completeConfirmation({auth},request('?code=synthetic'),origin);assert.equal(exchanges,1);
 await assert.rejects(completeConfirmation({auth},request('?error=cancelled'),origin));assert.equal(exchanges,1);
 auth.exchangeCodeForSession=async()=>({error:new Error('expired or missing PKCE verifier')});await assert.rejects(completeConfirmation({auth},request('?code=synthetic'),origin),/confirmation_failed/);
 auth.exchangeCodeForSession=async()=>({error:null});auth.getUser=async()=>({data:{user:{id:'synthetic',is_anonymous:true}},error:null});await assert.rejects(completeConfirmation({auth},request('?code=synthetic'),origin),/auth_required/);
});
