import { createHash } from 'node:crypto';
import { DomainError, idField, keys, object } from '../domain/contracts.ts';
import { openResult, sealResult } from './ledger.ts';
import type { AssistantLedger } from './ledger.ts';

export const MAX_VOICE_BYTES = 44 + 16000 * 2 * 60;
export function voiceInput(value: unknown) {
  const input = object(value);
  keys(input, ['requestId', 'audio']);
  const requestId = idField(input.requestId);
  if (requestId.length > 80 || typeof input.audio !== 'string' ||
      input.audio.length > Math.ceil(MAX_VOICE_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audio)) throw new DomainError('invalid_audio');
  const audio = Buffer.from(input.audio, 'base64');
  // Accept one canonical PCM format. Duration is derived from bytes, never a client claim.
  if (audio.length < 3244 || audio.length > MAX_VOICE_BYTES ||
      audio.toString('ascii', 0, 4) !== 'RIFF' || audio.readUInt32LE(4) !== audio.length - 8 ||
      audio.toString('ascii', 8, 16) !== 'WAVEfmt ' || audio.readUInt32LE(16) !== 16 ||
      audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1 ||
      audio.readUInt32LE(24) !== 16000 || audio.readUInt32LE(28) !== 32000 ||
      audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16 ||
      audio.toString('ascii', 36, 40) !== 'data' || audio.readUInt32LE(40) !== audio.length - 44 ||
      (audio.length - 44) % 2) throw new DomainError('invalid_audio');
  return { requestId: `voice_${requestId}`, audio };
}

export async function transcribeAudio(audio: Buffer, transport: typeof fetch = fetch) {
  const body = new FormData();
  body.set('model', 'gpt-transcribe');
  body.set('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'voice.wav');
  let response: Response;
  try {
    response = await transport('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body, signal: AbortSignal.timeout(45000),
    });
  } catch { throw new DomainError('transcription_unavailable'); }
  if (!response.ok) throw new DomainError('transcription_unavailable');
  const result = await response.json();
  if (typeof result.text !== 'string' || !result.text.trim()) throw new DomainError('no_speech');
  if (result.text.length > 4000) throw new DomainError('transcript_too_long');
  return result.text.trim() as string;
}

export async function runTranscription(input: ReturnType<typeof voiceInput>, workspace: string,
  ledger: AssistantLedger, transcribe = transcribeAudio) {
  const digest = createHash('sha256').update('voice:v1:').update(input.audio).digest('hex');
  const reservation = await ledger.reserve(input.requestId, digest);
  if (!reservation.fresh) {
    if (!reservation.payload) throw new DomainError('assistant_request_pending');
    const saved = object(openResult(workspace, input.requestId, reservation.payload));
    if (saved.stage !== 'transcribed' || typeof saved.text !== 'string') throw new DomainError('assistant_replay_invalid');
    return saved.text;
  }
  const text = await transcribe(input.audio);
  await ledger.save(input.requestId, digest, sealResult(workspace, input.requestId, { stage: 'transcribed', text }));
  return text;
}
