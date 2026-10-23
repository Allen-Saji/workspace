import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorage } from '../src/storage/sqlite.ts';
import { ingest, mutate, receipt } from '../src/domain/service.ts';
import { LOCAL_RELAY, WORKSPACE, freshness, validateReport } from '../src/domain/contracts.ts';
const report = (eventId = 'event_test') => ({schemaVersion:'1',eventId,checkpointId:'checkpoint_test',eventType:'checkpoint_reported',occurredAt:'2026-01-01T12:00:00Z',reportingMode:'explicit_checkpoint',isTest:true,summary:'Synthetic test report. No live agent activity.',source:{conversationRef:null,segmentRef:null,availability:'not_exposed'},entityRefs:[],captures:[{captureId:'capture_test',revision:1,type:'decision',content:'Synthetic learning decision',basis:'explicit',disposition:'proposed',sensitivity:'ordinary',remotePersistence:'not_exposed'}]});
test('commit survives close/reopen; retry returns original receipt and source timestamp', () => {
  const dir = mkdtempSync(join(tmpdir(),'allen-workspace-test-'));
  const path = join(dir,'workspace.sqlite');
  let db = new SqliteStorage(path);
  try {
    const first = ingest(db,LOCAL_RELAY,report()); db.close(); db = new SqliteStorage(path);
    const saved = receipt(db,LOCAL_RELAY,'event_test'); assert.deepEqual(saved,first);
    const duplicate = ingest(db,LOCAL_RELAY,report());
    assert.equal(duplicate.status,'duplicate'); assert.equal(duplicate.receiptId,first.receiptId);
    assert.equal(duplicate.committedAt,first.committedAt); assert.equal(db.list(WORKSPACE).length,1);
    assert.equal(db.reports(WORKSPACE)[0].report.occurredAt,report().occurredAt);
  } finally { db.close(); rmSync(dir,{recursive:true}); }
});
test('changed payload under same ID rejected with no mutation', () => {
  const db = new SqliteStorage(':memory:');
  try { ingest(db,LOCAL_RELAY,report()); assert.throws(() => ingest(db,LOCAL_RELAY,{...report(),summary:'Changed'}),/idempotency_conflict/); assert.equal(db.reports(WORKSPACE).length,1); } finally {db.close();}
});
test('scope cannot select another workspace or another connection; no broad read', () => {
  const db = new SqliteStorage(':memory:');
  try {
    ingest(db,LOCAL_RELAY,report());
    assert.throws(() => ingest(db,{...LOCAL_RELAY,workspaceId:'other'},report()),/scope_denied/);
    assert.throws(() => receipt(db,{...LOCAL_RELAY,workspaceId:'other'},'event_test'),/scope_denied/);
    assert.throws(() => receipt(db,{...LOCAL_RELAY,connectionId:'other'},'event_test'),/scope_denied/);
    assert.throws(() => ingest(db,{...LOCAL_RELAY,capabilities:[]},report()),/scope_denied/);
    assert.equal(db.list('other').length,0);
  } finally { db.close(); }
});
test('capture conflict rolls back whole report and earlier captures', () => {
  const db = new SqliteStorage(':memory:');
  try {
    ingest(db,LOCAL_RELAY,report());
    const changed = report('second'); changed.captures.unshift({...changed.captures[0],captureId:'new_capture'});
    assert.throws(() => ingest(db,LOCAL_RELAY,changed),/capture_conflict/);
    assert.equal(db.get(WORKSPACE,'new_capture'),undefined); assert.equal(receipt(db,LOCAL_RELAY,'second'),null);
  } finally { db.close(); }
});
test('workspace correction preserves provenance, history and unsynced truth; stale edits rejected', () => {
  const db = new SqliteStorage(':memory:');
  try {
    ingest(db,LOCAL_RELAY,report());
    const command = {id:'capture_test',kind:'capture',expectedRevision:1,data:{content:'Corrected here',userAccepted:true,disposition:'accepted'}};
    const updated = mutate(db,command);
    assert.equal(updated.revision,2); assert.equal(updated.data.correctedLocally,true);
    assert.equal(updated.data.remoteAcknowledgement,'not_exposed'); assert.equal(updated.data.eventId,'event_test');
    assert.equal(db.history(WORKSPACE,'capture_test')[0].data.content,'Synthetic learning decision');
    assert.throws(() => mutate(db,command),/revision_conflict/);
    assert.equal(db.reports(WORKSPACE)[0].report.captures[0].content,'Synthetic learning decision');
  } finally {db.close();}
});
test('reported owner approval never fabricates workspace user acceptance', () => {
  const db = new SqliteStorage(':memory:');
  try { const r=report(); r.captures[0].disposition='owner_approved'; ingest(db,LOCAL_RELAY,r);
    assert.equal(db.get(WORKSPACE,'capture_test')?.data.userAccepted,false);
    assert.equal(db.get(WORKSPACE,'capture_test')?.data.reportedDisposition,'owner_approved');
  } finally {db.close();}
});
test('closed registration cannot be approved or confer credentials', () => {
  const db = new SqliteStorage(':memory:');
  try {
    const data={displayName:'Synthetic adapter',status:'pending',requestedScopes:['reports:append']};
    mutate(db,{id:'reg_test',kind:'registration',expectedRevision:0,data});
    mutate(db,{id:'reg_test',kind:'registration',expectedRevision:1,data:{...data,status:'rejected'}});
    assert.throws(() => mutate(db,{id:'reg_test',kind:'registration',expectedRevision:2,data:{...data,status:'approved_for_local_test'}}),/registration_closed/);
    assert.equal(db.get(WORKSPACE,'reg_test')?.data.credentialIssued,false);
    assert.throws(() => mutate(db,{id:'bad_reg',kind:'registration',expectedRevision:0,data:{...data,status:'approved_for_local_test'}}),/registration_must_start_pending/);
    assert.throws(() => mutate(db,{id:'bad_scope',kind:'registration',expectedRevision:0,data:{...data,requestedScopes:['context:read']}}),/invalid_enum/);
  } finally {db.close();}
});
test('learning completion requires explicit evidence; tasks use owner self-report', () => {
  const db = new SqliteStorage(':memory:');
  try {
    assert.throws(() => mutate(db,{id:'lesson',kind:'lesson',expectedRevision:0,data:{title:'Learn',status:'completed',evidence:''}}),/invalid_text/);
    const lesson=mutate(db,{id:'lesson',kind:'lesson',expectedRevision:0,data:{title:'Learn',status:'completed',evidence:'I completed the practice exercise.'}});
    assert.equal(lesson.data.completionSource,'self_reported');
    const task=mutate(db,{id:'task',kind:'task',expectedRevision:0,data:{title:'Practice',status:'done',dueDate:''}});
    assert.equal(task.data.completionSource,'owner_self_report');
  } finally {db.close();}
});
test('reports reject extra instruction/scope fields, sensitive captures, malformed/oversized inputs', () => {
  assert.throws(() => validateReport({...report(),workspaceId:'other'}),/unknown_field/);
  assert.throws(() => validateReport({...report(),command:'execute'}),/unknown_field/);
  assert.throws(() => validateReport({...report(),summary:'a'.repeat(66000)}),/payload_too_large/);
  assert.throws(() => validateReport({...report(),occurredAt:'tomorrow'}),/invalid_timestamp/);
  assert.throws(() => validateReport({...report(),occurredAt:'2099-01-01T00:00:00Z'}),/invalid_timestamp/);
  const sensitive=report(); sensitive.captures[0].sensitivity='secret'; assert.throws(() => validateReport(sensitive),/invalid_enum/);
  const r=report(); r.captures.push(r.captures[0]); assert.throws(() => validateReport(r),/duplicate_capture_id/);
});
test('impossible dates and contradictory capture acceptance fail without writes', () => {
  const db = new SqliteStorage(':memory:');
  try {
    assert.throws(() => mutate(db,{id:'invalid_date_task',kind:'task',expectedRevision:0,data:{title:'Practice',status:'ready',dueDate:'2026-02-31'}}),/invalid_date/);
    assert.equal(db.get(WORKSPACE,'invalid_date_task'),undefined);
    const leap = mutate(db,{id:'leap_task',kind:'task',expectedRevision:0,data:{title:'Practice',status:'ready',dueDate:'2028-02-29'}});
    assert.equal(leap.data.dueDate,'2028-02-29');
    ingest(db,LOCAL_RELAY,report());
    for (const data of [{content:'Decision',userAccepted:false,disposition:'accepted'},{content:'Decision',userAccepted:true,disposition:'rejected'}]) {
      assert.throws(() => mutate(db,{id:'capture_test',kind:'capture',expectedRevision:1,data}),/inconsistent_acceptance/);
    }
    assert.equal(db.get(WORKSPACE,'capture_test')?.revision,1);
  } finally {db.close();}
});
test('silence and stale reports never imply running; delayed report preserves latest source timestamp', () => {
  assert.match(freshness(null),/unknown/); assert.match(freshness('2026-01-01T00:00:00Z',Date.parse('2026-01-03T00:00:00Z')),/Stale.*unknown/);
  assert.match(freshness('2026-01-01T00:00:00Z',Date.parse('2026-01-01T01:00:00Z')),/Recent.*unknown/);
  const db=new SqliteStorage(':memory:');
  try { const newer=report('newer'); newer.occurredAt='2026-02-01T00:00:00Z'; ingest(db,LOCAL_RELAY,newer);
    const older=report('older'); older.captures=[]; ingest(db,LOCAL_RELAY,older);
    const latest=db.reports(WORKSPACE).sort((a,b)=>Date.parse(b.report.occurredAt)-Date.parse(a.report.occurredAt))[0];
    assert.equal(latest.report.eventId,'newer');
  } finally {db.close();}
});
