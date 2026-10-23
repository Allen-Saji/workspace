export const WORKSPACE = 'allen-local-development';
export const CONNECTION = 'current-assistant-explicit-relay';
export type Scope = { workspaceId: string; connectionId: string; capabilities: readonly string[] };
export const LOCAL_RELAY: Scope = { workspaceId: WORKSPACE, connectionId: CONNECTION, capabilities: ['reports:append', 'receipts:read'] };
export class DomainError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export type CaptureInput = {
  captureId: string; revision: number; type: string; content: string;
  basis: 'explicit' | 'inferred' | 'unknown'; disposition: 'proposed' | 'owner_approved';
  sensitivity: 'ordinary'; remotePersistence: 'not_exposed';
};
export type Report = {
  schemaVersion: '1'; eventId: string; checkpointId: string;
  eventType: 'checkpoint_reported' | 'output_reported' | 'blocked_reported' | 'capture_reported';
  occurredAt: string; reportingMode: 'explicit_checkpoint'; isTest: boolean; summary: string;
  source: { conversationRef: string | null; segmentRef: string | null; availability: 'available' | 'not_exposed' };
  entityRefs: string[]; captures: CaptureInput[];
};
export type Receipt = {
  eventId: string; payloadDigest: string; receiptId: string; workspaceId: string;
  committedAt: string; records: { id: string; revision: number }[];
  status: 'saved' | 'duplicate'; remotePersistence: 'not_verified';
};
export type RecordKind = 'task' | 'lesson' | 'capture' | 'registration' | 'note' | 'meeting';
export type WorkspaceRecord = {
  id: string; kind: RecordKind; revision: number; updatedAt: string;
  data: Record<string, unknown>;
};
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('invalid_schema');
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new DomainError('unknown_field');
}
export function textField(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /\u0000/.test(value)) throw new DomainError('invalid_text');
  return value;
}
export function idField(value: unknown): string {
  const id = textField(value, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new DomainError('invalid_id');
  return id;
}
export function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new DomainError('invalid_enum');
  return value as T;
}
function reference(value: unknown): string | null {
  if (value === null) return null;
  return textField(value, 500); // Stored as inert text, never fetched or executed.
}
export function validateReport(input: unknown, now = Date.now()): Report {
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > 65536) throw new DomainError('payload_too_large');
  const r = object(input);
  keys(r, ['schemaVersion','eventId','checkpointId','eventType','occurredAt','reportingMode','isTest','summary','source','entityRefs','captures']);
  const source = object(r.source);
  keys(source, ['conversationRef','segmentRef','availability']);
  const occurredAt = textField(r.occurredAt, 40);
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt)) || Date.parse(occurredAt) > now + 300000) throw new DomainError('invalid_timestamp');
  if (typeof r.isTest !== 'boolean' || !Array.isArray(r.captures) || r.captures.length > 20 || !Array.isArray(r.entityRefs) || r.entityRefs.length > 20) throw new DomainError('invalid_schema');
  const captures = r.captures.map(input => {
    const c = object(input);
    keys(c, ['captureId','revision','type','content','basis','disposition','sensitivity','remotePersistence']);
    if (c.revision !== 1) throw new DomainError('initial_revision_required');
    return {
      captureId: idField(c.captureId), revision: 1,
      type: oneOf(c.type, ['fact','preference','decision','goal','proposed_task','unresolved_question']),
      content: textField(c.content), basis: oneOf(c.basis, ['explicit','inferred','unknown'] as const),
      disposition: oneOf(c.disposition, ['proposed','owner_approved'] as const),
      sensitivity: oneOf(c.sensitivity, ['ordinary'] as const),
      remotePersistence: oneOf(c.remotePersistence, ['not_exposed'] as const),
    };
  });
  if (new Set(captures.map(c => c.captureId)).size !== captures.length) throw new DomainError('duplicate_capture_id');
  const availability = oneOf(source.availability, ['available','not_exposed'] as const);
  const conversationRef = reference(source.conversationRef);
  const segmentRef = reference(source.segmentRef);
  if (availability === 'available' && !conversationRef && !segmentRef) throw new DomainError('missing_source');
  if (availability === 'not_exposed' && (conversationRef || segmentRef)) throw new DomainError('inconsistent_source');
  return {
    schemaVersion: oneOf(r.schemaVersion, ['1'] as const), eventId: idField(r.eventId), checkpointId: idField(r.checkpointId),
    eventType: oneOf(r.eventType, ['checkpoint_reported','output_reported','blocked_reported','capture_reported'] as const),
    occurredAt, reportingMode: oneOf(r.reportingMode, ['explicit_checkpoint'] as const), isTest: r.isTest,
    summary: textField(r.summary, 4000), source: { conversationRef, segmentRef, availability },
    entityRefs: r.entityRefs.map(idField), captures,
  };
}
export function freshness(reportedAt: string | null, now = Date.now()) {
  if (!reportedAt) return 'No report · current activity unknown';
  if (now - Date.parse(reportedAt) > 24 * 60 * 60 * 1000) return 'Stale report · current activity unknown';
  return 'Recent checkpoint · current activity unknown';
}
