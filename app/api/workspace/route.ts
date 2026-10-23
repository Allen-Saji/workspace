import { freshness } from '../../../src/domain/contracts.ts';
import { boundedJson, failure, guard } from '../../../src/server/http.ts';
import { runtimeConfig } from '../../../src/server/config.ts';
import { requestRepository } from '../../../src/server/repository.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  try {
    guard(request);
    const db = await requestRepository(request, headers);
    try {
      const snapshot = await db.snapshot();
      snapshot.reports.sort((a,b)=>Date.parse(b.report.occurredAt)-Date.parse(a.report.occurredAt));
      const lastReported = snapshot.reports.find(r=>!r.report.isTest)?.report.occurredAt ?? null;
      return Response.json({ ...snapshot, storageMode: runtimeConfig().mode, lastReported, freshness: freshness(lastReported), remoteAcknowledgement: 'not_exposed' }, { headers });
    } finally { db.close(); }
  } catch (error) { return failure(error, headers); }
}
export async function POST(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  try {
    guard(request, true);
    const db = await requestRepository(request, headers);
    try { return Response.json({ record: await db.mutate(await boundedJson(request)), status: 'saved' }, { headers }); }
    finally { db.close(); }
  } catch (error) { return failure(error, headers); }
}
