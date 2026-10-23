import { DomainError, idField, keys, object, validateReport } from '../domain/contracts.ts';
import type { Receipt, WorkspaceRecord } from '../domain/contracts.ts';
import type { WorkspaceRepository, WorkspaceSnapshot } from './repository.ts';

export interface RpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}
const domainErrors = new Set(['auth_required','scope_denied','workspace_not_provisioned','invalid_schema','invalid_text','invalid_enum','invalid_date','invalid_interval','invalid_revision','revision_conflict','kind_conflict','capture_requires_report','inconsistent_acceptance','invalid_scopes','registration_must_start_pending','registration_closed','invalid_transition','idempotency_conflict','capture_conflict','unknown_entity','payload_too_large','invalid_timestamp','duplicate_capture_id','invalid_id']);

export function supabaseRepository(client: RpcClient): WorkspaceRepository {
  async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new DomainError(domainErrors.has(error.message) ? error.message : 'storage_unavailable');
    return data as T;
  }
  return {
    snapshot: () => call<WorkspaceSnapshot>('workspace_snapshot'),
    async mutate(input) {
      const command = object(input);
      keys(command, ['id','kind','expectedRevision','data']);
      idField(command.id);
      // Full validation also lives in the database RPC. Direct Data API callers
      // cannot bypass revisions, source preservation or allowed state transitions.
      return call<WorkspaceRecord>('workspace_mutate', { command });
    },
    async ingest(input) {
      return call<Receipt>('workspace_ingest', { report: validateReport(input) });
    },
    async receipt(eventId) { return call<Receipt | null>('workspace_receipt', { event_id: idField(eventId) }); },
    close() {},
  };
}
