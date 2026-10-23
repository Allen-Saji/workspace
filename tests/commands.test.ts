import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorage } from '../src/storage/sqlite.ts';
import { applyCommand,undoCommand } from '../src/domain/commands.ts';
import { deterministicInterpreter as parser } from '../src/domain/interpreter.ts';
import { mutate } from '../src/domain/service.ts';
import { WORKSPACE } from '../src/domain/contracts.ts';
test('parser refuses ambiguous/destructive commands and invalid calendar times',()=>{
  for(const text of ['delete everything','meeting: Call | tomorrow | later','meeting: Call | 2026-02-30 09:00 | 2026-02-30 10:00'])assert.throws(()=>parser.propose(text));
  const p=parser.propose('task: Sample\nnote: Sample | text\nmeeting: Sample | 2026-10-25 09:00 | 2026-10-25 10:00');
  assert.equal(p.operations.length,3);assert.equal(p.operations[2].data.start,'2026-10-25T09:00:00+05:30');
});
test('multi-action failure rolls back records, history and receipt',()=>{
  const db=new SqliteStorage(':memory:');try{const p=parser.propose('task: Sample\nnote: Sample | text');p.operations[1].data.content='';
  assert.throws(()=>applyCommand(db,p));assert.equal(db.list(WORKSPACE).length,0);assert.equal(db.command(WORKSPACE,p.commandId),null);assert.equal(db.history(WORKSPACE,p.operations[0].id).length,0);
  }finally{db.close();}
});
test('commands require explicit meeting timezone and reject expired undo',()=>{
 const db=new SqliteStorage(':memory:');try{
 const p=parser.propose('meeting: Sample | 2026-10-25 09:00 | 2026-10-25 10:00');
 p.operations[0].data.start='2026-10-25T09:00';assert.throws(()=>applyCommand(db,p),/explicit_timezone_required/);
 const valid=parser.propose('task: Sample');const r=applyCommand(db,valid);db.saveCommand(WORKSPACE,{...r,committedAt:'2000-01-01T00:00:00Z'});
 assert.throws(()=>undoCommand(db,valid.commandId),/undo_expired/);assert.ok(db.get(WORKSPACE,valid.operations[0].id));
 }finally{db.close();}
});
test('receipt survives restart, duplicate retry and undo; changed payload rejected',()=>{
 const dir=mkdtempSync(join(tmpdir(),'workspace-command-'));let db=new SqliteStorage(join(dir,'test.sqlite'));
 try{const p=parser.propose('task: Sample\nnote: Sample | text');const r=applyCommand(db,p);db.close();db=new SqliteStorage(join(dir,'test.sqlite'));
 assert.deepEqual(applyCommand(db,p),r);assert.equal(db.command('another-workspace',p.commandId),null);
 assert.throws(()=>applyCommand(db,{...p,operations:[{...p.operations[0],data:{...p.operations[0].data,title:'Changed'}}]}),/idempotency_conflict/);
 const undone=undoCommand(db,p.commandId);assert.ok(undone.undo);assert.deepEqual(undoCommand(db,p.commandId),undone);assert.equal(db.list(WORKSPACE).length,0);
 assert.deepEqual(applyCommand(db,p),undone);assert.equal(db.list(WORKSPACE).length,0);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('stale apply and undo refuse the entire group; successful undo advances revision',()=>{
 const db=new SqliteStorage(':memory:');try{
 const initial=parser.propose('task: Original');applyCommand(db,initial);const old=initial.operations[0];
 const p=parser.propose('task: Changed\nnote: Sample | text');p.operations[0]={...old,expectedRevision:1,data:{...old.data,title:'Changed'}};
 applyCommand(db,p);mutate(db,{...p.operations[0],expectedRevision:2,data:{...old.data,title:'Manual'}});
 assert.throws(()=>undoCommand(db,p.commandId),/revision_conflict/);assert.ok(db.get(WORKSPACE,p.operations[1].id));
 const stale=parser.propose('note: Other | text');stale.operations.push({...old,expectedRevision:1});assert.throws(()=>applyCommand(db,stale),/revision_conflict/);assert.equal(db.get(WORKSPACE,stale.operations[0].id),undefined);
 const valid=parser.propose('task: Final');valid.operations[0]={...old,expectedRevision:3,data:{...old.data,title:'Final'}};applyCommand(db,valid);undoCommand(db,valid.commandId);
 assert.equal(db.get(WORKSPACE,old.id)?.revision,5);assert.equal(db.get(WORKSPACE,old.id)?.data.title,'Manual');
 }finally{db.close();}
});
