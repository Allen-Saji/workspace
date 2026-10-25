import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DomainError, WORKSPACE } from '../domain/contracts.ts';
import type { RuntimeConfig } from '../server/config.ts';
import { requestClient, requireUser } from '../server/supabase.ts';
import type { CalendarStore, StoredValue } from './types.ts';

export function localCalendarStore(path = resolve('.data/calendar.sqlite')): CalendarStore {
  mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS calendar_secrets (slot TEXT PRIMARY KEY, ciphertext TEXT, revision INTEGER NOT NULL)');
  function get(slot: string): StoredValue {
    const row = db.prepare('SELECT ciphertext,revision FROM calendar_secrets WHERE slot=?').get(slot);
    return row ? { ciphertext: row.ciphertext as string | null, revision: Number(row.revision) } : { ciphertext: null, revision: 0 };
  }
  return {
    identity: `local:${WORKSPACE}`,
    get: async slot => get(slot),
    async set(slot, ciphertext, revision) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (get(slot).revision !== revision) throw new DomainError('calendar_revision_conflict');
        db.prepare('INSERT INTO calendar_secrets VALUES(?,?,?) ON CONFLICT(slot) DO UPDATE SET ciphertext=excluded.ciphertext,revision=excluded.revision').run(slot, ciphertext, revision + 1);
        db.exec('COMMIT'); return { ciphertext, revision: revision + 1 };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close(),
  };
}

export type VerifiedCalendarOwner = { client: ReturnType<typeof requestClient>; userId: string };
export async function calendarStore(request: Request, headers: Headers, config: RuntimeConfig, verified?: VerifiedCalendarOwner): Promise<CalendarStore> {
  if (config.mode === 'sqlite') return localCalendarStore();
  const client = verified?.client ?? requestClient(request, config, headers);
  const userId = verified?.userId ?? await requireUser(client);
  async function call(action: string, slot: string, ciphertext: string | null = null, revision = 0) {
    const { data, error } = await client.rpc('workspace_calendar_secret', { action, slot, ciphertext, expected_revision: revision });
    if (error) throw new DomainError(['auth_required', 'workspace_not_provisioned', 'calendar_revision_conflict'].includes(error.message) ? error.message : 'calendar_storage_unavailable');
    return data as StoredValue & { workspaceId: string };
  }
  const initial = await call('get', 'tokens');
  return {
    identity: `${userId}:${initial.workspaceId}`,
    get: slot => call('get', slot),
    set: (slot, ciphertext, revision) => call('set', slot, ciphertext, revision),
    close() {},
  };
}
