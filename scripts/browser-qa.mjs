import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import sharp from 'sharp';
import {localDateAt} from '../src/journal/contracts.ts';
const origin='http://127.0.0.1:3218';
const browser=await chromium.launch({channel:'msedge',headless:true});
await mkdir('artifacts',{recursive:true});
const summary=[];
const sample=JSON.parse(await readFile('fixtures/checkpoint.sample.json','utf8'));
const agent=async(path,body,token)=>{const response=await fetch(origin+'/api/agent/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
try{
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:name==='mobile',hasTouch:name==='mobile'});
  // Only synthetic UI state; never read or write the existing local SQLite file.
  await context.route('**/api/workspace',r=>r.fulfill({json:{workspaceId:'synthetic-browser-qa',storageMode:'sqlite',records:[],reports:[],lastReported:null,freshness:'unknown'}}));
  await context.route('**/*',async r=>{if(new URL(r.request().url()).origin!==origin)return r.abort();return r.fallback();});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#agents');await page.getByRole('button',{name:'Create test pairing code'}).waitFor();
  assert.equal(await page.evaluate(()=>innerWidth),width);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Create test pairing code'}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:'Create test pairing code'}).click();await page.getByRole('button',{name:'Confirm pair',exact:true}).click();
  const code=await page.getByLabel('One-use test pairing code').inputValue();assert.equal(code.length,43);await page.getByRole('button',{name:'Hide code'}).click();
  const verifier=randomBytes(32).toString('base64url');const input={pairingCode:code,requestId:'browser-'+name,displayName:'SYNTHETIC '+name+' QA',requestedScopes:['reports:append','captures:append','receipts:read'],codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256'};
  const registration=await agent('registrations',input);assert.equal(registration.status,200);
  await page.getByRole('button',{name:'Refresh requests'}).click();
  const card=page.locator('article.registration').filter({hasText:input.displayName});
  await card.getByRole('button',{name:'Review approval'}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await card.getByRole('button',{name:'Review approval'}).click();await page.getByRole('button',{name:'Confirm approve'}).click();
  const exchange=await agent('exchange',{registrationId:registration.body.id,codeVerifier:verifier});assert.equal(exchange.status,200);
  const token=exchange.body.accessToken;const payload={...sample,eventId:'browser-event-'+name};const saved=await agent('events',payload,token);assert.equal(saved.status,200);
  assert.equal((await agent('events',payload,token)).body.receiptId,saved.body.receiptId);
  const sendV2=async(path,body)=>{const r=await fetch(origin+'/api/agent/v2/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  const observedAt=new Date(Date.now()-60000).toISOString(),sentAt=new Date().toISOString();
  const diary={schemaVersion:'2',kind:'diary',eventId:'diary-'+name,observedAt,sentAt,isTest:true,summary:'SYNTHETIC daily QA summary',evidence:[],localDate:localDateAt(observedAt,'Asia/Kolkata'),timezone:'Asia/Kolkata',expectedRevision:0,results:['SYNTHETIC successful check'],blockers:[],nextSteps:['Review synthetic result']};
  const firstDiary=await sendV2('diary',diary);assert.equal(firstDiary.revision,1);
  assert.equal((await sendV2('diary',{...diary,eventId:'diary-revised-'+name,expectedRevision:1})).revision,2);
  assert.equal((await sendV2('diary',diary)).receiptId,firstDiary.receiptId);
  const status={schemaVersion:'2',kind:'status',eventId:'status-'+name,observedAt,sentAt,isTest:true,summary:'SYNTHETIC active QA',evidence:[],state:'working'};
  await sendV2('status',status);await sendV2('status',{...status,eventId:'delayed-'+name,observedAt:new Date(Date.parse(observedAt)-3600000).toISOString(),state:'offline'});
  await page.getByRole('button',{name:'Refresh diary'}).click();await page.getByLabel('Agent',{exact:true}).selectOption({label:input.displayName+' (self-reported)'});
  await page.getByText('SYNTHETIC daily QA summary',{exact:true}).waitFor();assert.equal(await page.getByText('SYNTHETIC daily QA summary',{exact:true}).count(),1);
  await page.getByText(/Agent-reported working/).waitFor();await page.getByText(/revision 2/).waitFor();
  await page.getByText('Reporting preferences draft',{exact:true}).click();await page.getByLabel('IANA timezone').fill('America/New_York');await page.getByLabel('End of day (local time)').fill('19:30');await page.getByRole('button',{name:'Save reporting draft'}).click();await page.getByText(/Draft saved in this browser/).waitFor();
  await page.getByRole('button',{name:'Sync now instructions'}).click();assert.ok((await page.getByLabel('Sync request').inputValue()).includes('America/New_York'));await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.reload();await page.getByRole('button',{name:'Refresh requests'}).waitFor();await card.getByRole('button',{name:'Revoke test connection'}).waitFor();
  await card.getByRole('button',{name:'Revoke test connection'}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await agent('events',payload,token)).status,200);
  await card.getByRole('button',{name:'Revoke test connection'}).click();await page.getByRole('button',{name:'Confirm revoke'}).click();await card.getByText(/Identity unverified.*revoked/).waitFor();assert.equal((await agent('events',payload,token)).status,401);
  await page.getByText('Reporting preferences draft',{exact:true}).click();assert.equal(await page.getByLabel('IANA timezone').inputValue(),'America/New_York');assert.equal(await page.getByLabel('End of day (local time)').inputValue(),'19:30');
  await page.getByRole('link',{name:'Today',exact:true}).click();await page.goBack();await page.getByRole('heading',{name:'Connect an agent'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`artifacts/agent-${name}-qa.png`,fullPage:true});assert.deepEqual(errors,[]);
  summary.push({viewport:name,width,height,measuredWidth:await page.evaluate(()=>innerWidth),cancelApprovalRevoke:true,reload:true,back:true,revokedIngestionStatus:401,diaryRevision:2,oneEntryPerDay:true,lateStatusDidNotOverwrite:true,preferencesReload:true,manualSyncInstructions:true});await context.close();
 }
 const html=await (await fetch(origin)).text();
 for(const text of ['Workspace','summary_large_image','noindex','og:image:width','1200','630','icon.svg','apple-icon.png'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('workspace.allensaji.dev'));assert.ok(!html.includes('rel="canonical"'));
 const login=await (await fetch(origin+'/login')).text();assert.match(login,/Sign in.*Workspace/);assert.match(login,/noindex/);
 for(const [path,type,width,height] of [['/opengraph-image.png','image/png',1200,630],['/apple-icon.png','image/png',180,180],['/icon.svg','image/svg+xml',64,64]]){
  const response=await fetch(origin+path);assert.equal(response.status,200);assert.ok(response.headers.get('content-type').includes(type));const data=Buffer.from(await response.arrayBuffer());const m=await sharp(data).metadata();assert.equal(m.width,width);assert.equal(m.height,height);
 }
 const ico=await fetch(origin+'/favicon.ico');assert.equal(ico.status,200);assert.ok(ico.headers.get('content-type').includes('image/'));
 await writeFile('artifacts/browser-qa.json',JSON.stringify({summary,metadata:'passed',assets:'passed',scope:'isolated Edge contexts, synthetic UI and in-memory agent reports only'},null,2));
 console.log(JSON.stringify({summary,metadata:'passed',assets:'passed'}));
}finally{await browser.close();}
