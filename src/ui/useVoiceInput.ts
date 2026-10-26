"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const available = () => typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof window.MediaRecorder === 'function' && typeof window.AudioContext === 'function';

// Convert a completed browser recording to a bounded, canonical 16 kHz mono WAV.
async function wave(blob: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration < 0.1 || decoded.duration > 62) throw Error('Keep recordings under one minute.');
    const length = Math.min(960000, Math.floor(decoded.duration * 16000));
    const offline = new OfflineAudioContext(1, length, 16000);
    const source = offline.createBufferSource(); source.buffer = decoded;
    source.connect(offline.destination); source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const data = new ArrayBuffer(44 + samples.length * 2), view = new DataView(data);
    const label = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    label(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); label(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    label(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const v = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, v * (v < 0 ? 32768 : 32767), true); }
    let binary = ''; const bytes = new Uint8Array(data);
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  } finally { await context.close(); }
}

export function useVoiceInput(onTranscript: (text: string) => void) {
  const supported = useSyncExternalStore(subscribe, available, () => false);
  const [listening, setListening] = useState(false), [processing, setProcessing] = useState(false), [error, setError] = useState('');
  const callback = useRef(onTranscript), active = useRef<MediaRecorder | null>(null);
  const generation = useRef(0), pending = useRef(false), abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { callback.current = onTranscript; }, [onTranscript]);
  const release = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; active.current?.stream.getTracks().forEach(track => track.stop()); }, []);
  const cancel = useCallback(() => {
    generation.current++; pending.current = false; abort.current?.abort();
    if (active.current) { active.current.onstop = null; active.current.ondataavailable = null; active.current.onerror = null; if (active.current.state === 'recording') active.current.stop(); }
    release(); active.current = null; setListening(false); setProcessing(false);
  }, [release]);
  useEffect(() => {
    const hide = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); cancel(); };
  }, [cancel]);
  function stop() { if (active.current?.state === 'recording') active.current.stop(); release(); }
  async function start() {
    if (pending.current || active.current || processing) return;
    pending.current = true; const current = ++generation.current; setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (current !== generation.current) { stream.getTracks().forEach(track => track.stop()); return; }
      let recorder: MediaRecorder;
      try { recorder = new MediaRecorder(stream); } catch (e) { stream.getTracks().forEach(track => track.stop()); throw e; }
      active.current = recorder;
      const chunks: Blob[] = []; let size = 0;
      recorder.ondataavailable = event => { size += event.data.size; if (size > 5000000) { cancel(); setError('Recording is too large. Try a shorter request.'); } else chunks.push(event.data); };
      recorder.onerror = () => { cancel(); setError('Could not record audio. Check your microphone and try again.'); };
      recorder.onstop = async () => {
        release(); active.current = null; pending.current = false; setListening(false);
        if (current !== generation.current) return;
        setProcessing(true); const controller = new AbortController(); abort.current = controller;
        try {
          const audio = await wave(new Blob(chunks, { type: recorder.mimeType }));
          if (current !== generation.current) return;
          const response = await fetch('/api/assistant/transcribe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace-request': 'local-ui' }, body: JSON.stringify({ requestId: crypto.randomUUID(), audio }), signal: controller.signal });
          const result = await response.json();
          if (!response.ok) {
            const messages: Record<string, string> = { assistant_budget_exhausted: 'The daily AI budget is used up. You can still type.', assistant_not_enabled: 'Voice transcription is not enabled for this account.', no_speech: 'No speech was detected. Try again.', auth_required: 'Sign in again to use voice input.' };
            throw Error(messages[result.error?.code] ?? 'Transcription failed. Try again or type your request.');
          }
          if (current === generation.current) callback.current(result.text);
        } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : 'Transcription failed.'); }
        finally { if (current === generation.current) setProcessing(false); }
      };
      recorder.start(1000); setListening(true); pending.current = false;
      timer.current = setTimeout(stop, 60000);
    } catch (e) {
      if (current === generation.current) {
        release(); active.current = null; pending.current = false;
        setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in browser settings or type your request.' : 'Could not start the microphone. Check your input device.');
      }
    }
  }
  return { supported, listening, processing, error, start, stop, cancel };
}
