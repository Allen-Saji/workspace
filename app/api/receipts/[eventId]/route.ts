import { failure, guard } from '../../../../src/server/http.ts';
import { requestRepository } from '../../../../src/server/repository.ts';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ eventId: string }> }) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  try {
    guard(request);
    const db = await requestRepository(request, headers);
    try {
      const receipt = await db.receipt((await context.params).eventId);
      return Response.json({ receipt }, { headers, status: receipt ? 200 : 404 });
    } finally { db.close(); }
  } catch (error) { return failure(error, headers); }
}
