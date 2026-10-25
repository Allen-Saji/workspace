import { DomainError } from '../../../../src/domain/contracts.ts';
import { runtimeConfig } from '../../../../src/server/config.ts';
import { calendarService } from '../../../../src/calendar/service.ts';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
  let service: Awaited<ReturnType<typeof calendarService>> | undefined;
  const origin = runtimeConfig().origin;
  try {
    // Google returns a top-level cross-site GET. Session-bound state replaces
    // the JSON API's same-origin mutation guard on this single callback.
    if (request.headers.get('host') !== new URL(origin).host) throw new DomainError('host_denied');
    service = await calendarService(request, headers); await service.callback();
    headers.set('Location', origin + '/app?calendar=connected#calendar');
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'calendar_oauth_failed';
    headers.set('Location', origin + '/app?calendarError=' + encodeURIComponent(code) + '#calendar');
  } finally { service?.close(); }
  return new Response(null, { status: 303, headers });
}
