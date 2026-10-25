import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const alice = '11111111-1111-4111-8111-111111111111', bob = '22222222-2222-4222-8222-222222222222';

test('calendar ciphertext RPC isolates owners, enforces CAS and revoked sessions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid);
      create function auth.uid() returns uuid language sql stable as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
      grant usage on schema auth to authenticated,anon;
      insert into auth.users values('${alice}'),('${bob}');insert into auth.sessions values('${alice}','${alice}'),('${bob}','${bob}');`);
    for (const name of ['20261023132335_workspace_owner_isolation.sql', '20261025065933_calendar_credentials.sql']) await db.exec(readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    await db.query('insert into workspace_private.workspaces(owner_id) values($1),($2)', [alice, bob]);
    async function user(id: string) {
      await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ session_id: id, is_anonymous: false })]); await db.exec('set role authenticated');
    }
    async function call(action = 'get', slot = 'tokens', ciphertext: string | null = null, revision = 0) {
      const result = await db.query<{ value: { ciphertext: string | null; revision: number; workspaceId: string } }>('select public.workspace_calendar_secret($1,$2,$3,$4) value', [action, slot, ciphertext, revision]); return result.rows[0].value;
    }
    await user(alice);
    assert.equal((await call()).ciphertext, null);
    const saved = await call('set', 'tokens', 'v1.test.encrypted.tag'); assert.equal(saved.revision, 1);
    await assert.rejects(call('set', 'tokens', 'v1.test.changed.tag'), /calendar_revision_conflict/);
    await assert.rejects(call('set', 'tokens', 'plaintext-token', 1), /invalid_schema/);
    await assert.rejects(db.query('select * from workspace_private.calendar_secrets'), /permission denied/);
    await user(bob); assert.equal((await call()).ciphertext, null); assert.notEqual((await call()).workspaceId, saved.workspaceId);
    await call('set', 'tokens', 'v1.bob.encrypted.tag');
    await user(alice); assert.equal((await call()).ciphertext, 'v1.test.encrypted.tag');
    const cleared = await call('set', 'tokens', null, 1); assert.equal(cleared.revision, 2); assert.equal(cleared.ciphertext, null);
    await assert.rejects(call('get', 'arbitrary'), /invalid_schema/);
    await db.exec('reset role;set role anon'); await assert.rejects(call(), /permission denied/);
    await db.exec('reset role'); await db.query('delete from auth.sessions where user_id=$1', [alice]);
    await user(alice); await assert.rejects(call(), /auth_required/);
  } finally { await db.close(); }
});
