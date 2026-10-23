import { DomainError } from '../domain/contracts.ts';
const ORIGIN = 'http://127.0.0.1:3210';
export function guard(request: Request, mutation = false) {
  // Next may normalize the internal Request URL. Validate the client Host header,
  // with the server itself bound to loopback; never trust forwarded host headers.
  if (request.headers.get('host') !== '127.0.0.1:3210') throw new DomainError('host_denied');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new DomainError('origin_denied');
  const origin = request.headers.get('origin');
  if (origin && origin !== ORIGIN) throw new DomainError('origin_denied');
  if (mutation && (origin !== ORIGIN || request.headers.get('x-workspace-request') !== 'local-ui' || request.headers.get('content-type') !== 'application/json')) throw new DomainError('csrf_denied');
}
export async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('missing_body');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) { await reader.cancel(); throw new DomainError('payload_too_large'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DomainError('invalid_json'); }
}
export function failure(error: unknown) {
  const code = error instanceof DomainError ? error.code : 'internal_error';
  const status = code === 'internal_error' ? 500 : code.endsWith('_denied') ? 403 : code.endsWith('_conflict') ? 409 : code === 'payload_too_large' ? 413 : 422;
  return Response.json({error:{code,retryable:false}},{status,headers:{'Cache-Control':'no-store'}});
}
