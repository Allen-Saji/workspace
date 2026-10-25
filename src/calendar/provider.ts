import { createHash } from 'node:crypto';
import { DomainError, idField, keys, object, textField } from '../domain/contracts.ts';
import type { CalendarConfig, CalendarEvent, CalendarInfo, CalendarStore, EventDraft, TokenBundle } from './types.ts';
import { seal, unseal } from './crypto.ts';

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
];
type Json = Record<string, unknown>;
const API = 'https://www.googleapis.com/calendar/v3';
export type Fetcher = typeof fetch;

export async function providerJson(response: Response): Promise<Json> {
  // Provider failures can include credentials or user content. Never forward
  // raw bodies/errors to clients or logs.
  const reader = response.body?.getReader();
  if (!reader) throw new DomainError('calendar_provider_unavailable');
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 2_000_000) { await reader.cancel(); throw new DomainError('calendar_response_too_large'); }
    chunks.push(value);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new DomainError('calendar_provider_unavailable'); }
}

export function interval(from: unknown, to: unknown, maxDays = 90) {
  const valid = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value.slice(0, 10);
  };
  if (!valid(from) || !valid(to)) throw new DomainError('explicit_timezone_required');
  const start = Date.parse(from as string), end = Date.parse(to as string);
  if (end <= start || end - start > maxDays * 86400000) throw new DomainError('invalid_interval');
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

export function calendarId(value: unknown = 'primary'): string {
  const id = textField(value, 1024);
  if (/[\u0000-\u001f\u007f]/.test(id)) throw new DomainError('invalid_id');
  return id;
}

export function validateEvent(value: unknown): EventDraft {
  const event = object(value);
  keys(event, ['calendarId', 'id', 'etag', 'title', 'start', 'end', 'attendees', 'createMeet']);
  const dates = interval(event.start, event.end, 30);
  if (!Array.isArray(event.attendees) || event.attendees.length > 50 || typeof event.createMeet !== 'boolean') throw new DomainError('invalid_schema');
  const attendees = event.attendees.map(raw => {
    const address = textField(raw, 254).trim().toLowerCase();
    if (!/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(address)) throw new DomainError('invalid_attendee');
    return address;
  });
  if (new Set(attendees).size !== attendees.length) throw new DomainError('duplicate_attendee');
  if ((event.id === undefined) !== (event.etag === undefined)) throw new DomainError('calendar_etag_required');
  if (event.id !== undefined && !/^[a-zA-Z0-9_]{5,1024}$/.test(textField(event.id, 1024))) throw new DomainError('invalid_id');
  return {
    calendarId: calendarId(event.calendarId), title: textField(event.title, 200).trim(),
    start: dates.from, end: dates.to, attendees, createMeet: event.createMeet,
    ...(event.id === undefined ? {} : { id: event.id as string, etag: textField(event.etag, 200) }),
  };
}

function safeUrl(value: unknown, hosts: string[]): string | undefined {
  if (typeof value !== 'string') return;
  try { const url = new URL(value); if (url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password) return url.href; } catch {}
}

export function normalizeEvent(raw: Json, calendar: string): CalendarEvent {
  const start = object(raw.start), end = object(raw.end);
  const startValue = String(start.dateTime ?? start.date ?? ''), endValue = String(end.dateTime ?? end.date ?? '');
  const conference = raw.conferenceData && typeof raw.conferenceData === 'object' ? raw.conferenceData as Json : {};
  const entry = Array.isArray(conference.entryPoints) ? conference.entryPoints.find(e => e && e.entryPointType === 'video') : null;
  return {
    id: String(raw.id ?? ''), calendarId: calendar, title: String(raw.summary ?? 'Untitled event'),
    start: startValue, end: endValue, allDay: typeof start.date === 'string', etag: String(raw.etag ?? ''),
    attendees: Array.isArray(raw.attendees) ? raw.attendees.map(a => String(a.email ?? '')).filter(Boolean) : [],
    createMeet: !!(entry?.uri || raw.hangoutLink),
    htmlLink: safeUrl(raw.htmlLink, ['www.google.com', 'calendar.google.com']),
    joinUrl: safeUrl(entry?.uri ?? raw.hangoutLink, ['meet.google.com']),
    ...(typeof raw.recurringEventId === 'string' ? { recurringEventId: raw.recurringEventId } : {}),
    ...(raw.originalStartTime && typeof raw.originalStartTime === 'object' ? { originalStartTime: String((raw.originalStartTime as Json).dateTime ?? (raw.originalStartTime as Json).date ?? '') } : {}),
  };
}

export class GoogleCalendar {
  readonly store: CalendarStore;
  readonly config: CalendarConfig;
  readonly send: Fetcher;
  private expectedGrant?: string;
  constructor(store: CalendarStore, config: CalendarConfig, send: Fetcher = fetch) {
    this.store = store; this.config = config; this.send = send;
  }

  async credentials(forceRefresh = false): Promise<TokenBundle> {
    const stored = await this.store.get('tokens');
    if (!stored.ciphertext) throw new DomainError('calendar_not_connected');
    const bundle = unseal<TokenBundle & { reconnectRequired?: boolean }>(stored.ciphertext, `${this.store.identity}:tokens`, this.config.key);
    if (bundle.reconnectRequired) throw new DomainError('calendar_reconnect_required');
    if (!forceRefresh && bundle.expiresAt > Date.now() + 60000) return bundle;
    const response = await this.send('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: 'refresh_token', refresh_token: bundle.refreshToken }),
    });
    const data = await providerJson(response);
    if (!response.ok) {
      if (data.error === 'invalid_grant') {
        try { await this.store.set('tokens', seal({ ...bundle, reconnectRequired: true }, `${this.store.identity}:tokens`, this.config.key), stored.revision); } catch {}
        throw new DomainError('calendar_reconnect_required');
      }
      throw new DomainError('calendar_provider_unavailable');
    }
    if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') throw new DomainError('calendar_provider_unavailable');
    const next: TokenBundle = { ...bundle, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000,
      ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}) };
    try { await this.store.set('tokens', seal(next, `${this.store.identity}:tokens`, this.config.key), stored.revision); }
    catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'calendar_revision_conflict') throw error;
      const latest = await this.store.get('tokens');
      // A concurrent disconnect must win over this in-flight refresh.
      if (!latest.ciphertext) throw new DomainError('calendar_not_connected');
      return unseal<TokenBundle>(latest.ciphertext, `${this.store.identity}:tokens`, this.config.key);
    }
    return next;
  }

  async request(path: string, init: RequestInit = {}, allow: number[] = []): Promise<{ data: Json; status: number }> {
    // Only internal paths can reach this method; the provider origin is fixed.
    if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) throw new DomainError('invalid_schema');
    for (let attempt = 0; attempt < 2; attempt++) {
      const credentials = await this.credentials(attempt > 0);
      if (this.expectedGrant && createHash('sha256').update(credentials.refreshToken).digest('hex') !== this.expectedGrant) throw new DomainError('calendar_connection_changed');
      let response: Response;
      try {
        response = await this.send(API + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { ...init.headers, 'content-type': 'application/json', Authorization: `Bearer ${credentials.accessToken}` } });
      } catch { throw new DomainError('calendar_provider_unavailable'); }
      const data = await providerJson(response);
      if (response.status === 401 && attempt === 0) continue;
      if (response.ok || allow.includes(response.status)) return { data, status: response.status };
      if (response.status === 412) throw new DomainError('calendar_revision_conflict');
      if (response.status === 403) {
        const error = data.error && typeof data.error === 'object' ? data.error as Json : {};
        const details = [...(Array.isArray(error.errors) ? error.errors : []), ...(Array.isArray(error.details) ? error.details : [])];
        if (details.some(detail => detail && ['accessNotConfigured', 'SERVICE_DISABLED'].includes(String(detail.reason)))) throw new DomainError('calendar_api_disabled');
        throw new DomainError('calendar_permission_denied');
      }
      if (response.status === 404) throw new DomainError('calendar_event_not_found');
      if (response.status === 401) throw new DomainError('calendar_reconnect_required');
      if (response.status === 429) throw new DomainError('calendar_rate_limited');
      throw new DomainError('calendar_provider_unavailable');
    }
    throw new DomainError('calendar_reconnect_required');
  }

  async calendars(): Promise<{ calendars: CalendarInfo[] }> {
    const calendars: CalendarInfo[] = []; let pageToken = '';
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
      const { data } = await this.request(`/users/me/calendarList?${params}`);
      if (!Array.isArray(data.items)) throw new DomainError('calendar_provider_unavailable');
      for (const item of data.items) calendars.push({ id: String(item.id), title: String(item.summaryOverride ?? item.summary ?? 'Calendar'), timeZone: String(item.timeZone ?? 'UTC'), accessRole: String(item.accessRole ?? 'none'), primary: item.primary === true });
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      if (!pageToken) return { calendars };
    }
    throw new DomainError('calendar_response_too_large');
  }

  async events(calendar: string, from: string, to: string): Promise<{ events: CalendarEvent[]; truncated: boolean }> {
    calendar = calendarId(calendar); const range = interval(from, to); const events: CalendarEvent[] = []; let pageToken = '';
    for (let page = 0; page < 4; page++) {
      const params = new URLSearchParams({ timeMin: range.from, timeMax: range.to, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', ...(pageToken ? { pageToken } : {}) });
      const { data } = await this.request(`/calendars/${encodeURIComponent(calendar)}/events?${params}`);
      if (!Array.isArray(data.items)) throw new DomainError('calendar_provider_unavailable');
      for (const item of data.items) if (item.status !== 'cancelled') events.push(normalizeEvent(object(item), calendar));
      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      if (!pageToken) return { events, truncated: false };
    }
    return { events, truncated: true };
  }

  async freebusy(calendar: string, from: string, to: string) {
    calendar = calendarId(calendar); const range = interval(from, to);
    const { data } = await this.request('/freeBusy', { method: 'POST', body: JSON.stringify({ timeMin: range.from, timeMax: range.to, items: [{ id: calendar }] }) });
    const calendars = object(data.calendars), result = object(calendars[calendar]);
    if (Array.isArray(result.errors) && result.errors.length) throw new DomainError('calendar_availability_unavailable');
    if (!Array.isArray(result.busy)) throw new DomainError('calendar_provider_unavailable');
    const busy = result.busy.map(raw => { const item = object(raw); return { start: textField(item.start, 50), end: textField(item.end, 50) }; });
    return { busy, from: range.from, to: range.to };
  }

  async preview(requestId: string, input: unknown) {
    idField(requestId); const event = validateEvent(input);
    const grant = createHash('sha256').update((await this.credentials()).refreshToken).digest('hex');
    this.expectedGrant = grant;
    const path = `/calendars/${encodeURIComponent(event.calendarId)}`;
    // Membership and write permission are verified before presenting an action.
    const { data: calendar } = await this.request(`/users/me/calendarList/${encodeURIComponent(event.calendarId)}`);
    if (!['writer', 'owner'].includes(String(calendar.accessRole))) throw new DomainError('calendar_permission_denied');
    let current: Json | undefined;
    if (event.id) {
      current = (await this.request(`${path}/events/${encodeURIComponent(event.id)}`)).data;
      if (current.etag !== event.etag) throw new DomainError('calendar_revision_conflict');
      if (current.recurrence || current.recurringEventId) throw new DomainError('calendar_recurring_edit_unsupported');
      if ((current.start as Json | undefined)?.date || (current.eventType && current.eventType !== 'default')) throw new DomainError('calendar_event_edit_unsupported');
    }
    if (event.createMeet && !current?.conferenceData) {
      const properties = calendar.conferenceProperties as Json | undefined;
      if (!Array.isArray(properties?.allowedConferenceSolutionTypes) || !properties.allowedConferenceSolutionTypes.includes('hangoutsMeet')) throw new DomainError('calendar_meet_unavailable');
    }
    const proposal = seal({ event, requestId, grant, expiresAt: Date.now() + 10 * 60_000 }, `${this.store.identity}:proposal`, this.config.key);
    return { proposal, event };
  }

  async apply(proposal: string, confirmed: boolean) {
    if (confirmed !== true) throw new DomainError('calendar_confirmation_required');
    const payload = unseal<{ event: EventDraft; requestId: string; grant: string; expiresAt: number }>(textField(proposal, 30000), `${this.store.identity}:proposal`, this.config.key);
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now()) throw new DomainError('calendar_proposal_expired');
    const event = validateEvent(payload.event); idField(payload.requestId);
    const grant = createHash('sha256').update((await this.credentials()).refreshToken).digest('hex');
    if (payload.grant !== grant) throw new DomainError('calendar_connection_changed');
    this.expectedGrant = grant;
    const digest = createHash('sha256').update(JSON.stringify(event)).digest('hex');
    const operation = createHash('sha256').update(`${this.store.identity}:${payload.requestId}`).digest('hex');
    const base = `/calendars/${encodeURIComponent(event.calendarId)}/events`;
    const eventId = event.id ?? operation;
    const existing = await this.request(`${base}/${encodeURIComponent(eventId)}`, {}, [404]);
    const previous = existing.status === 404 ? null : existing.data;
    const previousPrivate = previous?.extendedProperties && typeof previous.extendedProperties === 'object' ? (previous.extendedProperties as Json).private as Json | undefined : undefined;
    if (previousPrivate?.workspaceOperation === operation) {
      if (previousPrivate.workspaceDigest !== digest) throw new DomainError('idempotency_conflict');
      return { event: normalizeEvent(previous!, event.calendarId) };
    }
    if (!event.id && previous) throw new DomainError('idempotency_conflict');
    if (event.id && (!previous || previous.etag !== event.etag)) throw new DomainError('calendar_revision_conflict');
    if (previous?.recurrence || previous?.recurringEventId) throw new DomainError('calendar_recurring_edit_unsupported');
    if (event.id && ((previous?.start as Json | undefined)?.date || (previous?.eventType && previous.eventType !== 'default'))) throw new DomainError('calendar_event_edit_unsupported');
    const body: Json = {
      summary: event.title, start: { dateTime: event.start }, end: { dateTime: event.end },
      attendees: event.attendees.map(email => {
        const prior = Array.isArray(previous?.attendees) ? previous.attendees.find(a => String(a.email).toLowerCase() === email) : null;
        return prior ?? { email };
      }),
      extendedProperties: { ...(previous?.extendedProperties as Json ?? {}), private: { ...previousPrivate, workspaceOperation: operation, workspaceDigest: digest } },
      ...(!event.id ? { id: eventId } : {}),
      ...(event.createMeet && !previous?.conferenceData ? { conferenceData: { createRequest: { requestId: operation, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
    };
    const query = '?conferenceDataVersion=1&sendUpdates=all';
    const result = await this.request(`${base}${event.id ? '/' + encodeURIComponent(event.id) : ''}${query}`, {
      method: event.id ? 'PATCH' : 'POST', body: JSON.stringify(body), ...(event.id ? { headers: { 'If-Match': event.etag! } } : {}),
    }, event.id ? [] : [409]);
    if (result.status === 409) {
      const { data } = await this.request(`${base}/${eventId}`);
      const marker = (data.extendedProperties as Json | undefined)?.private as Json | undefined;
      if (marker?.workspaceOperation !== operation || marker.workspaceDigest !== digest) throw new DomainError('idempotency_conflict');
      return { event: normalizeEvent(data, event.calendarId) };
    }
    return { event: normalizeEvent(result.data, event.calendarId) };
  }
}
