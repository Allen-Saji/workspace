import { LOCAL_RELAY } from '../../../src/domain/contracts.ts';
import { ingest } from '../../../src/domain/service.ts';
import { boundedJson, failure, guard } from '../../../src/server/http.ts';
import { openStore } from '../../../src/server/store.ts';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    guard(request,true); const payload = await boundedJson(request); const db = openStore();
    try { return Response.json(ingest(db,LOCAL_RELAY,payload),{headers:{'Cache-Control':'no-store'}}); }
    finally {db.close();}
  } catch(error) {return failure(error);}
}
