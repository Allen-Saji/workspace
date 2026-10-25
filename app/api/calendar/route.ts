import { DomainError, object, textField } from '../../../src/domain/contracts.ts';
import { guard, boundedJson, failure } from '../../../src/server/http.ts';
import { calendarService } from '../../../src/calendar/service.ts';
import { importCalendar } from '../../../src/calendar/import.ts';
import { requestRepository } from '../../../src/server/repository.ts';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  let service: Awaited<ReturnType<typeof calendarService>> | undefined;
  try {
    guard(request); service = await calendarService(request, headers);
    const params = new URL(request.url).searchParams, action = params.get('action') ?? 'status';
    if (action === 'status') return Response.json(await service.status(), { headers });
    if (action === 'calendars') return Response.json(await service.calendars(), { headers });
    if (action === 'events') return Response.json(await service.events(params.get('calendarId') ?? 'primary', params.get('from') ?? '', params.get('to') ?? ''), { headers });
    throw new DomainError('invalid_schema');
  } catch (error) { return failure(error, headers); } finally { service?.close(); }
}

export async function POST(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  let service: Awaited<ReturnType<typeof calendarService>> | undefined;
  try {
    guard(request, true);
    const input = object(await boundedJson(request));
    if (input.action === 'import') {
      // This local command preview needs no Google credentials. Use one verified
      // repository session, avoiding a second refresh of the same auth cookie.
      const repository = await requestRepository(request, headers);
      try {
        const snapshot = await repository.snapshot();
        return Response.json(importCalendar(textField(input.text, 60000), snapshot.records), { headers });
      } finally { repository.close(); }
    }
    service = await calendarService(request, headers);
    switch (input.action) {
      case 'connect': return Response.json(await service.connect(), { headers });
      case 'disconnect': return Response.json(await service.disconnect(), { headers });
      case 'preview': return Response.json(await service.preview(textField(input.requestId, 100), input.event), { headers });
      case 'apply': return Response.json(await service.apply(textField(input.proposal, 30000), input.confirmed === true), { headers });
      case 'freebusy': return Response.json(await service.freebusy(typeof input.calendarId === 'string' ? input.calendarId : 'primary', textField(input.from, 50), textField(input.to, 50)), { headers });
      default: throw new DomainError('invalid_schema');
    }
  } catch (error) { return failure(error, headers); } finally { service?.close(); }
}
