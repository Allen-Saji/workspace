import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MAX_VOICE_BYTES, runTranscription, transcribeAudio, voiceInput } from '../src/assistant/transcription.ts';
import type { AssistantLedger } from '../src/assistant/ledger.ts';
function wav(seconds=1){const b=Buffer.alloc(44+32000*seconds);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
function input(audio=wav()){return voiceInput({requestId:'qa',audio:audio.toString('base64')});}
function ledger(){const entries=new Map<string,{digest:string;payload:string|null}>();let used=0;return {summary:async()=>({limitUsd:1,usedUsd:used}),reserve:async(id:string,digest:string)=>{const p=entries.get(id);if(p){if(p.digest!==digest)throw Error('idempotency_conflict');return {fresh:false,payload:p.payload};}used+=.05;entries.set(id,{digest,payload:null});return {fresh:true,payload:null};},save:async(id:string,digest:string,payload:string)=>{entries.set(id,{digest,payload});},close(){}} satisfies AssistantLedger;}
process.env.WORKSPACE_INTEGRATION_KEY=randomBytes(32).toString('base64');
test('voice accepts only bounded canonical PCM and derives duration from actual bytes',()=>{
 assert.equal(input(wav(60)).audio.length,MAX_VOICE_BYTES);
 assert.throws(()=>input(wav(61)),/invalid_audio/);
 const b=wav();b.writeUInt32LE(8000,24);assert.throws(()=>input(b),/invalid_audio/);
 assert.throws(()=>input(Buffer.from('not an audio file')),/invalid_audio/);
 assert.throws(()=>voiceInput({requestId:'x',audio:'',workspaceId:'other'}),/unknown_field/);
 const forged=wav(61);forged.writeUInt32LE(32000,40);assert.throws(()=>input(forged),/invalid_audio/);
});
test('transcription reserves once and replays encrypted text without a second provider request',async()=>{
 const db=ledger();let calls=0;const fn=async()=>{calls++;return 'Plan tomorrow';};
 assert.equal(await runTranscription(input(),'owner',db,fn),'Plan tomorrow');
 assert.equal(await runTranscription(input(),'owner',db,fn),'Plan tomorrow');
 assert.equal(calls,1);assert.equal((await db.summary()).usedUsd,.05);
 await assert.rejects(runTranscription(input(wav(2)),'owner',db,fn),/idempotency_conflict/);
});
test('uncertain transcription fails closed on replay and does not refund a reservation',async()=>{
 const db=ledger();let calls=0;const fn=async()=>{calls++;throw Error('network');};
 await assert.rejects(runTranscription(input(),'owner',db,fn),/network/);
 await assert.rejects(runTranscription(input(),'owner',db,fn),/assistant_request_pending/);
 assert.equal(calls,1);assert.equal((await db.summary()).usedUsd,.05);
});
test('provider receives only audio and fixed model; errors do not expose upstream details',async()=>{
 assert.equal(await transcribeAudio(wav(),async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');const form=init!.body as FormData;assert.deepEqual([...form.keys()],['model','file']);assert.equal(form.get('model'),'gpt-transcribe');return Response.json({text:'Test phrase'});}), 'Test phrase');
 await assert.rejects(transcribeAudio(wav(),async()=>Response.json({secret:'hidden'},{status:500})),/transcription_unavailable/);
 await assert.rejects(transcribeAudio(wav(),async()=>Response.json({text:''})),/no_speech/);
});
