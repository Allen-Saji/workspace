import ICAL from 'ical.js';
import { createHash } from 'node:crypto';
import { DomainError } from '../domain/contracts.ts';
import type { WorkspaceRecord } from '../domain/contracts.ts';
import type { Operation, Proposal } from '../domain/commands.ts';

// The workspace meeting schema is timed, non-recurring. Refuse unsupported
// semantics before producing ANY command, rather than losing calendar data.
export function importCalendar(text: string, existing: WorkspaceRecord[] = []): { proposal: Proposal; warnings: string[] } {
  if (Buffer.byteLength(text) > 60000) throw new DomainError('payload_too_large');
  try {
    const root = new ICAL.Component(ICAL.parse(text));
    if (root.name !== 'vcalendar') throw new DomainError('calendar_import_invalid');
    const components = root.getAllSubcomponents('vevent');
    if (!components.length) throw new DomainError('calendar_import_empty');
    if (components.length > 10) throw new DomainError('calendar_import_too_many_events');
    const ids = new Set<string>();
    const operations: Operation[] = components.map(component => {
      if (['rrule', 'rdate', 'exdate', 'recurrence-id'].some(name => component.hasProperty(name))) throw new DomainError('calendar_import_recurrence_unsupported');
      if (String(component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED') throw new DomainError('calendar_import_cancelled_event');
      const uid = component.getFirstPropertyValue('uid');
      if (typeof uid !== 'string' || !uid || uid.length > 1000) throw new DomainError('calendar_import_uid_required');
      const id = 'ics_' + createHash('sha256').update(uid).digest('hex');
      if (ids.has(id)) throw new DomainError('calendar_import_duplicate_uid'); ids.add(id);
      const event = new ICAL.Event(component);
      if (event.startDate.isDate || event.endDate.isDate) throw new DomainError('calendar_import_all_day_unsupported');
      if (!component.hasProperty('dtstart') || (!component.hasProperty('dtend') && !component.hasProperty('duration'))) throw new DomainError('calendar_import_end_required');
      function iso(time: InstanceType<typeof ICAL.Time>, property: string): string {
        const tzid = component.getFirstProperty(property)?.getParameter('tzid');
        if (time.zone === ICAL.Timezone.utcTimezone) return time.toJSDate().toISOString();
        if (time.zone !== ICAL.Timezone.localTimezone && time.zone.tzid !== 'floating') return time.toJSDate().toISOString();
        if (typeof tzid === 'string' && tzid) return zonedToIso(time.toString().replace(/Z$/, ''), tzid);
        // A DURATION inherits the start's timezone.
        if (property === 'dtend' && !component.hasProperty('dtend')) {
          const start = Date.parse(iso(event.startDate, 'dtstart'));
          return new Date(start + event.duration.toSeconds() * 1000).toISOString();
        }
        throw new DomainError('calendar_import_timezone_required');
      }
      const start = iso(event.startDate, 'dtstart'), end = iso(event.endDate, 'dtend');
      if (Date.parse(end) <= Date.parse(start)) throw new DomainError('invalid_interval');
      const title = event.summary?.trim();
      if (!title || title.length > 200) throw new DomainError('invalid_text');
      const old = existing.find(item => item.id === id);
      if (old && old.kind !== 'meeting') throw new DomainError('kind_conflict');
      return { id, kind: 'meeting', expectedRevision: old?.revision ?? 0, data: { title, start, end } };
    });
    const commandId = 'ics_' + createHash('sha256').update(JSON.stringify(operations)).digest('hex');
    return { proposal: { commandId, timezone: 'Asia/Kolkata', operations }, warnings: ['Imports meeting titles and times into Workspace. Attendees, reminders, attachments and calendar invitations are not imported.'] };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('calendar_import_invalid');
  }
}

// Intl supplies the host's IANA database. Find a unique instant for the local
// wall time, and reject DST gaps/folds instead of choosing the wrong meeting.
export function zonedToIso(local: string, zone: string): string {
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
  catch { throw new DomainError('calendar_import_timezone_unsupported'); }
  const target = Date.parse(local + 'Z');
  if (!Number.isFinite(target)) throw new DomainError('invalid_date');
  const wall = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  };
  // Sampling around the date captures both DST offsets, including half-hour
  // transitions. The range also covers date-line changes.
  const candidates = new Set<number>();
  for (let offset = -48; offset <= 48; offset += 6) {
    const sample = target + offset * 3600000;
    const instant = target - (wall(sample) - sample);
    if (wall(instant) === target) candidates.add(instant);
  }
  if (candidates.size !== 1) throw new DomainError('calendar_import_ambiguous_time');
  return new Date([...candidates][0]).toISOString();
}
