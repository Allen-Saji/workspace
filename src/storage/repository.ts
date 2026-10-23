import type { Receipt, WorkspaceRecord } from '../domain/contracts.ts';
import type { StoredReport } from './port.ts';

// Operation-level port: hosted writes must be single database transactions, not
// a sequence of HTTP table writes masquerading as a synchronous transaction.
export interface WorkspaceSnapshot {
  workspaceId: string;
  records: WorkspaceRecord[];
  reports: StoredReport[];
}
export interface WorkspaceRepository {
  snapshot(): Promise<WorkspaceSnapshot>;
  mutate(input: unknown): Promise<WorkspaceRecord>;
  ingest(input: unknown): Promise<Receipt>;
  receipt(eventId: string): Promise<Receipt | null>;
  close(): void;
}
