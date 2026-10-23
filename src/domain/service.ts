import { createHash, randomUUID } from 'node:crypto';
import { CONNECTION, DomainError, WORKSPACE, idField, keys, object, oneOf, textField, validateReport } from './contracts.ts';
import type { Receipt, Scope, WorkspaceRecord } from './contracts.ts';
import type { Storage } from '../storage/port.ts';
function authorize(scope: Scope, capability: string) {
  if (scope.workspaceId !== WORKSPACE || scope.connectionId !== CONNECTION || !scope.capabilities.includes(capability)) throw new DomainError('scope_denied');
}
export function ingest(storage: Storage, scope: Scope, input: unknown): Receipt {
  authorize(scope, 'reports:append');
  const report = validateReport(input);
  const payloadDigest = createHash('sha256').update(JSON.stringify(report)).digest('hex');
  return storage.transaction(() => {
    const prior = storage.findReport(scope.workspaceId, scope.connectionId, report.eventId);
    if (prior) {
      if (prior.receipt.payloadDigest !== payloadDigest) throw new DomainError('idempotency_conflict');
      return { ...prior.receipt, status: 'duplicate' };
    }
    for (const id of report.entityRefs) if (!storage.get(scope.workspaceId,id)) throw new DomainError('unknown_entity');
    const committedAt = new Date().toISOString();
    for (const c of report.captures) {
      if (storage.get(scope.workspaceId,c.captureId)) throw new DomainError('capture_conflict');
      const record: WorkspaceRecord = { id: c.captureId, kind: 'capture', revision: 1, updatedAt: committedAt,
        data: { ...c, eventId: report.eventId, connectionId: scope.connectionId, source: report.source,
          occurredAt: report.occurredAt, receivedAt: committedAt, isTest: report.isTest,
          userAccepted: false, reportedDisposition: c.disposition, workspaceSaved: true,
          remoteAcknowledgement: 'not_exposed', correctedLocally: false, entityRefs: report.entityRefs } };
      storage.put(scope.workspaceId,record); storage.audit(scope.workspaceId,record);
    }
    const receipt: Receipt = { eventId: report.eventId, receiptId: randomUUID(), payloadDigest,
      workspaceId: scope.workspaceId, committedAt, records: report.captures.map(c => ({ id: c.captureId, revision: 1 })),
      status: 'saved', remotePersistence: 'not_verified' };
    storage.addReport(scope.workspaceId,{ connectionId: scope.connectionId, report, receipt });
    return receipt;
  }); // Returns only after COMMIT. Any error rolls back both captures and receipt.
}
export function receipt(storage: Storage, scope: Scope, eventId: string): Receipt | null {
  authorize(scope, 'receipts:read');
  return storage.findReport(scope.workspaceId,scope.connectionId,idField(eventId))?.receipt ?? null;
}
// Called only by local owner UI/CLI. Reports cannot call this service or gain mutation capabilities.
export function mutate(storage: Storage, input: unknown): WorkspaceRecord {
  const command = object(input);
  keys(command,['id','kind','expectedRevision','data']);
  const id = idField(command.id);
  const kind = oneOf(command.kind,['task','lesson','capture','registration','note','meeting'] as const);
  const data = object(command.data);
  if (!Number.isSafeInteger(command.expectedRevision) || Number(command.expectedRevision) < 0) throw new DomainError('invalid_revision');
  return storage.transaction(() => {
    const old = storage.get(WORKSPACE,id);
    if ((old?.revision ?? 0) !== command.expectedRevision) throw new DomainError('revision_conflict');
    if (old && old.kind !== kind) throw new DomainError('kind_conflict');
    let next: Record<string, unknown>;
    if (kind === 'task') {
      keys(data,['title','status','dueDate']);
      const dueDate = data.dueDate === '' ? '' : textField(data.dueDate,10);
      if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0,10) !== dueDate)) throw new DomainError('invalid_date');
      next = { title:textField(data.title,200), status:oneOf(data.status,['ready','in_progress','done']),dueDate,completionSource: data.status === 'done' ? 'owner_self_report' : null };
    } else if (kind === 'lesson') {
      keys(data,['title','status','evidence']);
      const status = oneOf(data.status,['not_started','in_progress','completed']);
      next = { title:textField(data.title,200),status,evidence:status === 'completed' ? textField(data.evidence,1000) : '',completionSource:status === 'completed' ? 'self_reported' : null };
    } else if (kind === 'capture') {
      if (!old) throw new DomainError('capture_requires_report');
      keys(data,['content','userAccepted','disposition']);
      if (typeof data.userAccepted !== 'boolean') throw new DomainError('invalid_schema');
      const content = textField(data.content);
      const disposition = oneOf(data.disposition,['proposed','accepted','rejected','archived']);
      if ((disposition === 'accepted' && !data.userAccepted) || (['proposed','rejected'].includes(disposition) && data.userAccepted)) throw new DomainError('inconsistent_acceptance');
      next = { ...old.data,content,userAccepted:data.userAccepted,disposition,
        correctedLocally:old.data.correctedLocally || content !== old.data.content,remoteAcknowledgement:'not_exposed' };
    } else if (kind === 'registration') {
      keys(data,['displayName','status','requestedScopes']);
      const status = oneOf(data.status,['pending','approved_for_local_test','rejected','revoked']);
      if (!Array.isArray(data.requestedScopes) || data.requestedScopes.length === 0 || data.requestedScopes.length > 2) throw new DomainError('invalid_scopes');
      const requestedScopes = data.requestedScopes.map(s => oneOf(s,['reports:append','captures:append']));
      if (!old && status !== 'pending') throw new DomainError('registration_must_start_pending');
      if (old && (old.data.status === 'rejected' || old.data.status === 'revoked')) throw new DomainError('registration_closed');
      if (old?.data.status === 'approved_for_local_test' && status !== 'revoked') throw new DomainError('invalid_transition');
      next = {displayName:textField(data.displayName,100),status,requestedScopes,identity:'unverified',credentialIssued:false,isTest:true};
    } else if (kind === 'meeting') {
      keys(data,['title','start','end']);
      const start = textField(data.start,40), end = textField(data.end,40);
      if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) throw new DomainError('invalid_interval');
      next = { title:textField(data.title,200),start,end,provenance:'manual',calendarConnected:false };
    } else {
      keys(data,['title','content']);
      next = {title:textField(data.title,200),content:textField(data.content,4000)};
    }
    const record: WorkspaceRecord = {id,kind,revision:(old?.revision ?? 0)+1,updatedAt:new Date().toISOString(),data:{...old?.data,...next}};
    storage.put(WORKSPACE,record); storage.audit(WORKSPACE,record); return record;
  });
}
