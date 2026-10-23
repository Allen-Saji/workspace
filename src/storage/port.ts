import type { Receipt, Report, WorkspaceRecord } from '../domain/contracts.ts';
export interface StoredReport { connectionId: string; report: Report; receipt: Receipt }
// Domain services depend on this port. A hosted adapter must also implement its transaction/isolation guarantees.
export interface Storage {
  transaction<T>(operation: () => T): T;
  get(workspace: string, id: string): WorkspaceRecord | undefined;
  list(workspace: string): WorkspaceRecord[];
  put(workspace: string, record: WorkspaceRecord): void;
  findReport(workspace: string, connection: string, eventId: string): StoredReport | undefined;
  reports(workspace: string): StoredReport[];
  addReport(workspace: string, report: StoredReport): void;
  audit(workspace: string, record: WorkspaceRecord): void;
  history(workspace: string, id: string): WorkspaceRecord[];
  close(): void;
}
