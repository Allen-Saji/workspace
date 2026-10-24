import {createHash,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {DomainError,idField} from '../domain/contracts.ts';
import {validateJournal} from './contracts.ts';
import type {DiaryEntry,JournalReceipt,JournalSnapshot,StatusEntry} from './contracts.ts';
/** Internal primitive: caller holds the same transaction as token authorization. */
export class JournalStore{
 private db:DatabaseSync;
 constructor(db:DatabaseSync){this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS diary_entries(workspace TEXT NOT NULL,connection TEXT NOT NULL,date TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(workspace,connection,date));
 CREATE TABLE IF NOT EXISTS journal_events(workspace TEXT NOT NULL,connection TEXT NOT NULL,event TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(workspace,connection,event));`);}
 ingest(workspace:string,connection:string,input:unknown,now=Date.now()){
  const report=validateJournal(input,now),digest=createHash('sha256').update(JSON.stringify(report)).digest('hex');
  const prior=this.receipt(workspace,connection,report.eventId);if(prior){if(prior.payloadDigest!==digest)throw new DomainError('idempotency_conflict');return {...prior,status:'duplicate' as const};}
  const receivedAt=new Date(now).toISOString();const receipt:JournalReceipt={eventId:report.eventId,receiptId:randomUUID(),payloadDigest:digest,receivedAt,connectionId:connection,kind:report.kind,status:'saved'};
  if(report.kind==='diary'){
   const row=this.db.prepare('SELECT body FROM diary_entries WHERE workspace=? AND connection=? AND date=?').get(workspace,connection,report.localDate);
   const old=row?JSON.parse(String(row.body)) as DiaryEntry:null;
   if((old?.revision??0)!==report.expectedRevision)throw new DomainError('revision_conflict');
   if(old&&old.timezone!==report.timezone)throw new DomainError('timezone_conflict');
   const entry:DiaryEntry={connectionId:connection,localDate:report.localDate,timezone:report.timezone,revision:report.expectedRevision+1,receivedAt,report};
   this.db.prepare('INSERT INTO diary_entries VALUES(?,?,?,?) ON CONFLICT(workspace,connection,date) DO UPDATE SET body=excluded.body').run(workspace,connection,report.localDate,JSON.stringify(entry));
   receipt.localDate=report.localDate;receipt.revision=entry.revision;
  }
  this.db.prepare('INSERT INTO journal_events VALUES(?,?,?,?)').run(workspace,connection,report.eventId,JSON.stringify({connectionId:connection,report,receipt}));return receipt;
 }
 receipt(workspace:string,connection:string,eventId:string):JournalReceipt|null{const row=this.db.prepare('SELECT body FROM journal_events WHERE workspace=? AND connection=? AND event=?').get(workspace,connection,idField(eventId));return row?JSON.parse(String(row.body)).receipt:null;}
 snapshot(workspace:string):JournalSnapshot{
  const diaries=this.db.prepare('SELECT body FROM diary_entries WHERE workspace=? ORDER BY date DESC,connection').all(workspace).map(r=>JSON.parse(String(r.body)) as DiaryEntry);
  const latest=new Map<string,StatusEntry>();
  for(const row of this.db.prepare('SELECT body FROM journal_events WHERE workspace=?').all(workspace)){
   const event=JSON.parse(String(row.body));if(event.report.kind!=='status')continue;
   const prior=latest.get(event.connectionId);const rank=(r:{observedAt:string;sentAt:string;eventId:string})=>r.observedAt+'|'+r.sentAt+'|'+r.eventId;
   if(!prior||rank(event.report)>rank(prior.report))latest.set(event.connectionId,{connectionId:event.connectionId,report:event.report,receivedAt:event.receipt.receivedAt});
  }
  return {diaries,statuses:[...latest.values()]};
 }
}
