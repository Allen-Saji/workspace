import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {JournalStore} from '../src/journal/store.ts';import {localDateAt,validateJournal,statusLabel,reportingPreferences} from '../src/journal/contracts.ts';
const now=Date.parse('2026-10-24T20:00:00Z');
const diary={schemaVersion:'2',kind:'diary',eventId:'day-1',observedAt:'2026-10-23T19:00:00.000Z',sentAt:'2026-10-24T18:00:00.000Z',isTest:true,summary:'SYNTHETIC work summary',evidence:[{label:'Example result',url:'https://example.com/result'}],localDate:'2026-10-24',timezone:'Asia/Kolkata',expectedRevision:0,results:['Completed example'],blockers:[],nextSteps:['Review example']};
test('local date follows configured zone across midnight and DST repeats',()=>{
 assert.equal(localDateAt('2026-10-23T18:29:59Z','Asia/Kolkata'),'2026-10-23');assert.equal(localDateAt('2026-10-23T18:30:00Z','Asia/Kolkata'),'2026-10-24');
 assert.equal(localDateAt('2026-11-01T05:30:00Z','America/New_York'),'2026-11-01');assert.equal(localDateAt('2026-11-01T06:30:00Z','America/New_York'),'2026-11-01');
 assert.equal(localDateAt('2026-03-08T09:59:59Z','America/Los_Angeles'),'2026-03-08');assert.equal(localDateAt('2026-03-08T10:00:00Z','America/Los_Angeles'),'2026-03-08');
 assert.equal(validateJournal(diary,now).kind,'diary');assert.throws(()=>validateJournal({...diary,localDate:'2026-10-23'},now),/invalid_local_date/);
 assert.throws(()=>validateJournal({...diary,timezone:'Not/AZone'},now),/invalid_timezone/);assert.throws(()=>validateJournal({...diary,observedAt:'2026-02-31T00:00:00Z'},now),/invalid_timestamp/);
 assert.throws(()=>validateJournal({...diary,evidence:[{label:'bad',url:'https://example.com/?token=secret'}]},now),/invalid_evidence/);
 assert.deepEqual(reportingPreferences('Asia/Kolkata','19:30',3),{timezone:'Asia/Kolkata',endOfDay:'19:30',activeCadenceHours:3});assert.throws(()=>reportingPreferences('UTC','25:00',3),/invalid_preferences/);
});
test('one daily entry supports revision, immutable receipts, backfill and restart without status duplicates',()=>{
 const dir=mkdtempSync(join(tmpdir(),'workspace-journal-'));let db=new DatabaseSync(join(dir,'test.sqlite'));let store=new JournalStore(db);
 const save=(body:unknown,connection='agent-a')=>{db.exec('BEGIN IMMEDIATE');try{const r=store.ingest('w',connection,body,now);db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 try{
  const receipt=save(diary);assert.equal(receipt.revision,1);assert.equal(save(diary).receiptId,receipt.receiptId);assert.equal(save(diary).status,'duplicate');
  assert.throws(()=>save({...diary,summary:'changed'}),/idempotency_conflict/);assert.throws(()=>save({...diary,eventId:'new-id'}),/revision_conflict/);
  const revision=save({...diary,eventId:'day-2',expectedRevision:1,results:['Updated result']});assert.equal(revision.revision,2);assert.equal(store.snapshot('w').diaries.length,1);
  assert.throws(()=>save({...diary,eventId:'new-zone',expectedRevision:2,timezone:'Asia/Colombo'}),/timezone_conflict/);
  save({...diary,eventId:'yesterday',observedAt:'2026-10-22T19:00:00.000Z',localDate:'2026-10-23'});assert.equal(store.snapshot('w').diaries.length,2);
  save(diary,'agent-b');assert.equal(store.snapshot('w').diaries.length,3);assert.equal(store.snapshot('other').diaries.length,0);assert.equal(store.receipt('other','agent-a',diary.eventId),null);
  const status={schemaVersion:'2',kind:'status',eventId:'working',observedAt:'2026-10-24T18:00:00.000Z',sentAt:'2026-10-24T18:01:00.000Z',state:'working',summary:'SYNTHETIC active work',isTest:true,evidence:[]};save(status);
  save({...status,eventId:'delayed',observedAt:'2026-10-24T12:00:00.000Z',sentAt:'2026-10-24T19:00:00.000Z',state:'offline'});
  assert.equal(store.snapshot('w').statuses[0].report.state,'working');assert.equal(store.snapshot('w').diaries.length,3);
  assert.match(statusLabel(store.snapshot('w').statuses[0],now),/Agent-reported working/);assert.match(statusLabel(store.snapshot('w').statuses[0],now+5*3600000),/Stale.*unknown/);assert.match(statusLabel(undefined,now),/Unknown/);
  db.close();db=new DatabaseSync(join(dir,'test.sqlite'));store=new JournalStore(db);assert.equal(store.snapshot('w').diaries.find(d=>d.localDate===diary.localDate&&d.connectionId==='agent-a')?.revision,2);assert.equal(store.receipt('w','agent-a','day-1')?.receiptId,receipt.receiptId);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
