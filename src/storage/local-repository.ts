import { LOCAL_RELAY, WORKSPACE } from '../domain/contracts.ts';
import { ingest, mutate, receipt } from '../domain/service.ts';
import type { Storage } from './port.ts';
import type { WorkspaceRepository } from './repository.ts';

export function localRepository(db: Storage): WorkspaceRepository {
  return {
    async snapshot() {
      return db.transaction(() => ({ workspaceId: WORKSPACE, records: db.list(WORKSPACE), reports: db.reports(WORKSPACE) }));
    },
    async mutate(input) { return mutate(db, input); },
    async ingest(input) { return ingest(db, LOCAL_RELAY, input); },
    async receipt(id) { return receipt(db, LOCAL_RELAY, id); },
    close() { db.close(); },
  };
}
