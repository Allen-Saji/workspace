import test from 'node:test';
import assert from 'node:assert/strict';
import { googleAvailable, startGoogle } from '../src/server/google-auth.ts';
import { requestClient } from '../src/server/supabase.ts';
import { guard } from '../src/server/http.ts';
const config = {mode:'supabase' as const,origin:'http://127.0.0.1:3212',url:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'};
test('Google starts disabled, local mode never starts and rejected setup makes no SDK calls', async()=>{
 let calls=0;
 const client={auth:{signInWithOAuth:async()=>{calls++;return {data:{url:null},error:null};}}};
 assert.equal(googleAvailable(config,'disabled'),false);
 assert.equal(googleAvailable({mode:'sqlite',origin:config.origin},'enabled'),false);
 await assert.rejects(startGoogle(client,config,'disabled'),/configuration_required/);
 assert.equal(calls,0);
});
test('Google requests only identity scopes and validates authorization destination',async()=>{
 let returned=config.url+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(config.origin+'/auth/callback');
 const client={auth:{signInWithOAuth:async(input:unknown)=>{
 assert.deepEqual(input,{provider:'google',options:{redirectTo:config.origin+'/auth/callback',scopes:'openid email profile',skipBrowserRedirect:true}});
 return {data:{url:returned},error:null};}}};
 assert.equal(await startGoogle(client,config,'enabled'),returned);
 for(const bad of ['https://evil.test/auth/v1/authorize','javascript:alert(1)',config.url+'/wrong',returned+'&ignored=1#fragment',returned.replace('provider=google','provider=github'),returned.replace('3212','3213')]){
 returned=bad;await assert.rejects(startGoogle(client,config,'enabled'),/google_signin_unavailable/);
 }
});
test('Installed SSR SDK creates PKCE verifier cookie and S256 challenge without a hosted call',async()=>{
 const headers=new Headers();
 const request=new Request(config.origin,{headers:{host:'127.0.0.1:3212'}});
 const client=requestClient(request,config,headers);
 const url=new URL(await startGoogle(client,config,'enabled'));
 assert.equal(url.searchParams.get('code_challenge_method'),'s256');
 assert.ok(url.searchParams.get('code_challenge'));
 assert.equal(url.searchParams.get('scopes'),'openid email profile');
 const cookies=headers.getSetCookie();
 assert.ok(cookies.some(c=>c.includes('code-verifier')&&/HttpOnly/i.test(c)&&/SameSite=lax/i.test(c)));
 assert.ok(!url.searchParams.has('access_type'));
});
test('OAuth initiation requires same-origin POST protection',()=>{
 const headers={host:'127.0.0.1:3212',origin:config.origin,'content-type':'application/json','x-workspace-request':'local-ui'};
 guard(new Request(config.origin+'/api/auth/google',{method:'POST',headers}),true,config.origin);
 for(const override of [{origin:'https://evil.test'},{'x-workspace-request':''},{host:'evil.test'}]){
 assert.throws(()=>guard(new Request(config.origin+'/api/auth/google',{method:'POST',headers:{...headers,...override}}),true,config.origin));
 }
});
