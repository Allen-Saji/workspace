import { DomainError } from '../../../../src/domain/contracts.ts';
import { boundedJson, failure, guard } from '../../../../src/server/http.ts';
import { requestRepository } from '../../../../src/server/repository.ts';
import { assistantConfigured } from '../../../../src/assistant/provider.ts';
import { assistantLedger } from '../../../../src/assistant/ledger.ts';
import { MAX_VOICE_BYTES, runTranscription, voiceInput } from '../../../../src/assistant/transcription.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  try {
    guard(request, true);
    const db = await requestRepository(request, headers);
    try {
      const { workspaceId } = await db.snapshot();
      if (!assistantConfigured()) throw new DomainError('assistant_not_enabled');
      const ledger = await assistantLedger(request, headers, workspaceId);
      try {
        const input = voiceInput(await boundedJson(request, Math.ceil(MAX_VOICE_BYTES / 3) * 4 + 256));
        const text = await runTranscription(input, workspaceId, ledger);
        return Response.json({ text, budget: await ledger.summary() }, { headers });
      } finally { ledger.close(); }
    } finally { db.close(); }
  } catch (error) { return failure(error, headers); }
}
