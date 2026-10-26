import { DomainError } from '../domain/contracts.ts';
import { runtimeConfig } from './config.ts';
export function guard(request: Request, mutation = false, expectedOrigin = runtimeConfig().origin) {
  // Next may normalize the internal Request URL. Validate the client Host header,
  // with the server itself bound to loopback; never trust forwarded host headers.
  if (request.headers.get('host') !== new URL(expectedOrigin).host) throw new DomainError('host_denied');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new DomainError('origin_denied');
  const origin = request.headers.get('origin');
  if (origin && origin !== expectedOrigin) throw new DomainError('origin_denied');
  if (mutation && (origin !== expectedOrigin || request.headers.get('x-workspace-request') !== 'local-ui' || request.headers.get('content-type') !== 'application/json')) throw new DomainError('csrf_denied');
}
export async function boundedJson(request: Request, maxBytes = 65536): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('missing_body');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new DomainError('payload_too_large'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DomainError('invalid_json'); }
}
export function failure(error: unknown, headers = new Headers()) {
  const code = error instanceof DomainError ? error.code : 'internal_error';
  const status = code === 'auth_required' ? 401 : ['configuration_required','storage_unavailable'].includes(code) ? 503 : code === 'internal_error' ? 500 : code.endsWith('_denied') || code === 'workspace_not_provisioned' ? 403 : code.endsWith('_conflict') ? 409 : code === 'payload_too_large' ? 413 : 422;
  headers.set('Cache-Control','private, no-store');
  return Response.json({error:{code,retryable:false}},{status,headers});
}
