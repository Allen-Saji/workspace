import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorkspaceRecord } from '../domain/contracts.ts';
import type { Storage, StoredReport } from './port.ts';
import type { CommandReceipt } from '../domain/commands.ts';
export class SqliteStorage implements Storage {
  private db: DatabaseSync;
  constructor(path: string | DatabaseSync) {
    if (typeof path === 'string' && path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = typeof path === 'string' ? new DatabaseSync(path, { timeout: 5000 }) : path;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS records (workspace TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(workspace,id));
      CREATE TABLE IF NOT EXISTS reports (workspace TEXT NOT NULL,connection TEXT NOT NULL,event TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(workspace,connection,event));
      CREATE TABLE IF NOT EXISTS history (workspace TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(workspace,id,revision));
      CREATE TABLE IF NOT EXISTS commands (workspace TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(workspace,id));
      INSERT OR IGNORE INTO migrations VALUES (1);`);
  }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(workspace: string, id: string): WorkspaceRecord | undefined {
    const row = this.db.prepare('SELECT body FROM records WHERE workspace=? AND id=?').get(workspace,id);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  list(workspace: string): WorkspaceRecord[] {
    return this.db.prepare('SELECT body FROM records WHERE workspace=? ORDER BY id').all(workspace).map(r => JSON.parse(String(r.body)));
  }
  put(workspace: string, record: WorkspaceRecord) {
    this.db.prepare('INSERT INTO records VALUES (?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET body=excluded.body').run(workspace,record.id,JSON.stringify(record));
  }
  findReport(workspace: string, connection: string, eventId: string): StoredReport | undefined {
    const row = this.db.prepare('SELECT body FROM reports WHERE workspace=? AND connection=? AND event=?').get(workspace,connection,eventId);
    return row ? JSON.parse(String(row.body)) : undefined;
  }
  reports(workspace: string): StoredReport[] {
    return this.db.prepare('SELECT body FROM reports WHERE workspace=?').all(workspace).map(r => JSON.parse(String(r.body)));
  }
  addReport(workspace: string, report: StoredReport) {
    this.db.prepare('INSERT INTO reports VALUES (?,?,?,?)').run(workspace,report.connectionId,report.report.eventId,JSON.stringify(report));
  }
  audit(workspace: string, record: WorkspaceRecord) {
    this.db.prepare('INSERT INTO history VALUES (?,?,?,?)').run(workspace,record.id,record.revision,JSON.stringify(record));
  }
  history(workspace: string, id: string): WorkspaceRecord[] {
    return this.db.prepare('SELECT body FROM history WHERE workspace=? AND id=? ORDER BY revision').all(workspace,id).map(r => JSON.parse(String(r.body)));
  }
  close() { this.db.close(); }
  command(workspace:string,id:string):CommandReceipt|null {
    const row=this.db.prepare('SELECT body FROM commands WHERE workspace=? AND id=?').get(workspace,id);
    return row?JSON.parse(String(row.body)):null;
  }
  saveCommand(workspace:string,r:CommandReceipt){this.db.prepare('INSERT INTO commands VALUES(?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET body=excluded.body').run(workspace,r.commandId,JSON.stringify(r));}
  remove(workspace:string,id:string){this.db.prepare('DELETE FROM records WHERE workspace=? AND id=?').run(workspace,id);}
}
