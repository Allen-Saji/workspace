import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal, unseal, integrationKey } from '../src/calendar/crypto.ts';
import { GoogleCalendar, CALENDAR_SCOPES, interval, normalizeEvent } from '../src/calendar/provider.ts';
import type { CalendarConfig, CalendarStore, StoredValue, TokenBundle, EventDraft } from '../src/calendar/types.ts';
import { DomainError } from '../src/domain/contracts.ts';
import { importCalendar, zonedToIso } from '../src/calendar/import.ts';

const key = randomBytes(32);
const config: CalendarConfig = { origin: 'http://127.0.0.1:3210', clientId: 'test-client', clientSecret: 'test-only', key };
function store(identity = 'owner:workspace'): CalendarStore {
  const slots = new Map<string, StoredValue>();
  return { identity, async get(slot) { return slots.get(slot) ?? { ciphertext: null, revision: 0 }; },
    async set(slot, ciphertext, revision) {
      if ((slots.get(slot)?.revision ?? 0) !== revision) throw new DomainError('calendar_revision_conflict');
      const value = { ciphertext, revision: revision + 1 }; slots.set(slot, value); return value;
    }, close() {} };
}
async function authorized(expiresAt = Date.now() + 3600_000) {
  const db = store();
  const tokens: TokenBundle = { accessToken: 'fake-access', refreshToken: 'fake-refresh', expiresAt, scopes: CALENDAR_SCOPES };
  await db.set('tokens', seal(tokens, `${db.identity}:tokens`, key), 0); return db;
}
const draft: EventDraft = { calendarId: 'primary', title: 'Review', start: '2026-10-27T10:00:00+05:30', end: '2026-10-27T10:30:00+05:30', attendees: ['guest@example.com'], createMeet: true };
const json = (data: unknown, status = 200) => Response.json(data, { status });

test('calendar encryption binds ciphertext to owner and purpose and detects changes', () => {
  const ciphertext = seal({ value: 'private' }, 'alice:tokens', key);
  assert.deepEqual(unseal(ciphertext, 'alice:tokens', key), { value: 'private' });
  assert.throws(() => unseal(ciphertext, 'bob:tokens', key), /calendar_token_invalid/);
  assert.throws(() => unseal(ciphertext, 'alice:proposal', key), /calendar_token_invalid/);
  assert.throws(() => unseal(ciphertext.slice(0, -4) + 'abcd', 'alice:tokens', key), /calendar_token_invalid/);
  assert.throws(() => integrationKey('bad'), /calendar_configuration_required/);
});

test('calendar create preview, confirmation, retry and changed-request conflict', async () => {
  const db = await authorized(); let remote: Record<string, unknown> | null = null; let creates = 0;
  const google = new GoogleCalendar(db, config, async (url, init) => {
    const path = String(url);
    assert.ok(path.startsWith('https://www.googleapis.com/calendar/v3/'));
    if (path.includes('/calendarList/')) return json({ accessRole: 'owner', conferenceProperties: { allowedConferenceSolutionTypes: ['hangoutsMeet'] } });
    if (init?.method === 'POST') {
      creates++; const input = JSON.parse(String(init.body));
      assert.equal(new URL(path).searchParams.get('sendUpdates'), 'all');
      assert.equal(input.attendees[0].email, 'guest@example.com');
      remote = { ...input, etag: 'etag-one' }; return json(remote);
    }
    return remote ? json(remote) : json({ error: { code: 404 } }, 404);
  });
  const preview = await google.preview('request_1', draft);
  await assert.rejects(google.apply(preview.proposal, false), /calendar_confirmation_required/);
  const result = await google.apply(preview.proposal, true);
  assert.equal(result.event.title, 'Review'); assert.equal(creates, 1);
  assert.deepEqual(await google.apply(preview.proposal, true), result); assert.equal(creates, 1);
  const changed = await google.preview('request_1', { ...draft, title: 'Changed' });
  await assert.rejects(google.apply(changed.proposal, true), /idempotency_conflict/);
  const other = new GoogleCalendar(store('other:workspace'), config, google.send);
  await assert.rejects(other.apply(preview.proposal, true), /calendar_token_invalid/);
  const expired = seal({ requestId: 'request_expired', event: draft, expiresAt: Date.now() - 1 }, `${db.identity}:proposal`, key);
  await assert.rejects(google.apply(expired, true), /calendar_proposal_expired/);
});

test('calendar updates use etags, preserve RSVP and existing conference', async () => {
  const db = await authorized(); let patch: Record<string, unknown> | null = null;
  const current = { id: 'event123', summary: 'Review', start: { dateTime: draft.start }, end: { dateTime: draft.end }, etag: 'v1',
    attendees: [{ email: 'guest@example.com', responseStatus: 'accepted' }], conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } };
  const google = new GoogleCalendar(db, config, async (url, init) => {
    if (String(url).includes('/calendarList/')) return json({ accessRole: 'writer' });
    if (init?.method === 'PATCH') { assert.equal((init.headers as Record<string, string>)['If-Match'], 'v1'); patch = JSON.parse(String(init.body)); return json({ ...current, ...patch, etag: 'v2' }); }
    return json(current);
  });
  const preview = await google.preview('update_1', { ...draft, id: 'event123', etag: 'v1', createMeet: false });
  const result = await google.apply(preview.proposal, true);
  assert.equal(result.event.joinUrl, 'https://meet.google.com/abc-defg-hij');
  assert.ok(patch); assert.equal((patch as Record<string, unknown>).conferenceData, undefined);
  assert.equal(((patch as Record<string, unknown>).attendees as Record<string, unknown>[])[0].responseStatus, 'accepted');
  // Keeping a conference does not require permission to create another one.
  await google.preview('keep_conference', { ...draft, id: 'event123', etag: 'v1', createMeet: true });
  await assert.rejects(google.preview('update_2', { ...draft, id: 'event123', etag: 'stale', createMeet: false }), /calendar_revision_conflict/);
});

test('calendar rejects previews from a previous connected Google account', async () => {
  const db = await authorized(); let writes = 0;
  const google = new GoogleCalendar(db, config, async (_url, init) => {
    if (init?.method === 'POST') writes++;
    return json({ accessRole: 'owner', conferenceProperties: { allowedConferenceSolutionTypes: ['hangoutsMeet'] } });
  });
  const preview = await google.preview('before_reconnect', draft);
  const stored = await db.get('tokens');
  const changed: TokenBundle = { accessToken: 'different-access', refreshToken: 'different-account-refresh', expiresAt: Date.now() + 3600_000, scopes: CALENDAR_SCOPES };
  await db.set('tokens', seal(changed, `${db.identity}:tokens`, key), stored.revision);
  await assert.rejects(google.apply(preview.proposal, true), /calendar_connection_changed/);
  assert.equal(writes, 0);
});

test('calendar recovers an uncertain successful create without resending invitations', async () => {
  const db = await authorized(); let remote: Record<string, unknown> | null = null; let creates = 0;
  const google = new GoogleCalendar(db, config, async (url, init) => {
    if (String(url).includes('/calendarList/')) return json({ accessRole: 'owner' });
    if (init?.method === 'POST') {
      creates++; remote = { ...JSON.parse(String(init.body)), etag: 'saved-on-google' };
      throw new Error('Connection lost after Google saved the event');
    }
    return remote ? json(remote) : json({ error: { code: 404 } }, 404);
  });
  const preview = await google.preview('uncertain_create', { ...draft, createMeet: false });
  await assert.rejects(google.apply(preview.proposal, true), /calendar_provider_unavailable/);
  const recovered = await google.apply(preview.proposal, true);
  assert.equal(recovered.event.etag, 'saved-on-google'); assert.equal(creates, 1);
});

test('calendar reports a provider precondition failure without retrying the edit', async () => {
  const db = await authorized(); let writes = 0;
  const current = { id: 'event123', summary: 'Review', start: { dateTime: draft.start }, end: { dateTime: draft.end }, etag: 'v1' };
  const google = new GoogleCalendar(db, config, async (url, init) => {
    if (String(url).includes('/calendarList/')) return json({ accessRole: 'writer' });
    if (init?.method === 'PATCH') { writes++; return json({ error: { code: 412 } }, 412); }
    return json(current);
  });
  const preview = await google.preview('racing_edit', { ...draft, id: 'event123', etag: 'v1', createMeet: false });
  await assert.rejects(google.apply(preview.proposal, true), /calendar_revision_conflict/);
  assert.equal(writes, 1);
});

test('calendar rejects unsupported all-day and recurring edits before signing', async () => {
  const db = await authorized(); let current: Record<string, unknown> = { id: 'event123', etag: 'v1', start: { date: '2026-10-27' }, end: { date: '2026-10-28' } };
  const google = new GoogleCalendar(db, config, async url => String(url).includes('/calendarList/') ? json({ accessRole: 'owner' }) : json(current));
  await assert.rejects(google.preview('all_day', { ...draft, id: 'event123', etag: 'v1', createMeet: false }), /calendar_event_edit_unsupported/);
  current = { ...current, start: { dateTime: draft.start }, end: { dateTime: draft.end }, recurringEventId: 'series1' };
  await assert.rejects(google.preview('recurring', { ...draft, id: 'event123', etag: 'v1', createMeet: false }), /calendar_recurring_edit_unsupported/);
});

test('calendar refresh preserves refresh token and invalid grant requests reconnect', async () => {
  const db = await authorized(0); let refreshes = 0;
  const google = new GoogleCalendar(db, config, async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token'); assert.equal(new URLSearchParams(String(init?.body)).get('refresh_token'), 'fake-refresh'); refreshes++;
    return json({ access_token: 'new-fake-access', expires_in: 3600 });
  });
  const tokens = await google.credentials(); assert.equal(tokens.refreshToken, 'fake-refresh'); await google.credentials(); assert.equal(refreshes, 1);
  const revoked = new GoogleCalendar(await authorized(0), config, async () => json({ error: 'invalid_grant' }, 400));
  await assert.rejects(revoked.credentials(), /calendar_reconnect_required/);
  await assert.rejects(revoked.credentials(), /calendar_reconnect_required/);
});

test('calendar does not treat unknown availability as free and bounds event windows', async () => {
  const google = new GoogleCalendar(await authorized(), config, async () => json({ calendars: { primary: { errors: [{ reason: 'notFound' }] } } }));
  await assert.rejects(google.freebusy('primary', draft.start, draft.end), /calendar_availability_unavailable/);
  assert.throws(() => interval('2026-02-30T10:00:00Z', '2026-03-04T10:00:00Z'), /explicit_timezone_required/);
  assert.throws(() => interval('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z'), /invalid_interval/);
  const normalized = normalizeEvent({ id: 'a', start: { date: '2026-10-25' }, end: { date: '2026-10-26' }, htmlLink: 'javascript:alert(1)', hangoutLink: 'https://evil.example/' }, 'primary');
  assert.equal(normalized.allDay, true); assert.equal(normalized.joinUrl, undefined); assert.equal(normalized.htmlLink, undefined);
});

function ics(properties: string) { return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-one\r\nSUMMARY:Review\r\n${properties}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`; }
test('ICS produces stable local meeting proposals and preserves explicit timezone', () => {
  const text = ics('DTSTART;TZID=Asia/Kolkata:20261027T100000\r\nDTEND;TZID=Asia/Kolkata:20261027T103000');
  const result = importCalendar(text); assert.deepEqual(importCalendar(text), result);
  assert.equal(result.proposal.operations[0].data.start, '2026-10-27T04:30:00.000Z');
  assert.ok(result.warnings.length);
  const previous = result.proposal.operations[0];
  const edited = importCalendar(text, [{ ...previous, revision: 3, updatedAt: '2026-01-01', data: previous.data }]);
  assert.equal(edited.proposal.operations[0].expectedRevision, 3);
});

test('ICS refuses recurrence, all-day, unresolved timezone and ambiguous DST without partial imports', () => {
  const timing = 'DTSTART:20261027T100000Z\r\nDTEND:20261027T103000Z';
  assert.throws(() => importCalendar(ics(timing + '\r\nRRULE:FREQ=DAILY')), /calendar_import_recurrence_unsupported/);
  assert.throws(() => importCalendar(ics('DTSTART;VALUE=DATE:20261027\r\nDTEND;VALUE=DATE:20261028')), /calendar_import_all_day_unsupported/);
  assert.throws(() => importCalendar(ics('DTSTART:20261027T100000\r\nDTEND:20261027T103000')), /calendar_import_timezone_required/);
  assert.throws(() => importCalendar(ics('DTSTART;TZID=Moon/Base:20261027T100000\r\nDTEND;TZID=Moon/Base:20261027T103000')), /calendar_import_timezone_unsupported/);
  assert.throws(() => zonedToIso('2026-11-01T01:30:00', 'America/New_York'), /calendar_import_ambiguous_time/);
  assert.throws(() => zonedToIso('2026-03-08T02:30:00', 'America/New_York'), /calendar_import_ambiguous_time/);
});

test('disabled Calendar API is distinguished from a calendar permission denial', async () => {
  const disabled = new GoogleCalendar(await authorized(), config, async () => json({ error: { errors: [{ reason: 'accessNotConfigured' }] } }, 403));
  await assert.rejects(disabled.calendars(), /calendar_api_disabled/);
  const denied = new GoogleCalendar(await authorized(), config, async () => json({ error: { errors: [{ reason: 'forbidden' }] } }, 403));
  await assert.rejects(denied.calendars(), /calendar_permission_denied/);
});
