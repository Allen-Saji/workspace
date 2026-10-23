import { boundedJson, failure, guard } from '../../../src/server/http.ts';
import { requestRepository } from '../../../src/server/repository.ts';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  try {
    guard(request, true);
    const db = await requestRepository(request, headers);
    try { return Response.json(await db.ingest(await boundedJson(request)), { headers }); }
    finally { db.close(); }
  } catch (error) { return failure(error, headers); }
}
