import { WORKSPACE, freshness } from '../../../src/domain/contracts.ts';
import { mutate } from '../../../src/domain/service.ts';
import { boundedJson, failure, guard } from '../../../src/server/http.ts';
import { openStore } from '../../../src/server/store.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    guard(request);
    const db = openStore();
    try {
      const reports = db.reports(WORKSPACE).sort((a,b)=>Date.parse(b.report.occurredAt)-Date.parse(a.report.occurredAt));
      const lastReported = reports.find(r=>!r.report.isTest)?.report.occurredAt ?? null;
      return Response.json({workspaceId:WORKSPACE,storage:'Local development only; no hosted sync',records:db.list(WORKSPACE),reports,lastReported,freshness:freshness(lastReported),remoteAcknowledgement:'not_exposed'}, {headers:{'Cache-Control':'no-store'}});
    } finally { db.close(); }
  } catch(error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    guard(request,true); const command = await boundedJson(request);
    const db = openStore();
    try { return Response.json({record:mutate(db,command),status:'saved'},{headers:{'Cache-Control':'no-store'}}); }
    finally {db.close();}
  } catch(error) { return failure(error); }
}
