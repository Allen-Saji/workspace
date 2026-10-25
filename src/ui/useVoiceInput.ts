"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type RecognitionResult = {
  isFinal: boolean;
  [index: number]: { transcript: string };
};
type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

const subscribe = () => () => {};
const voiceAvailable = () => {
  const browser = window as VoiceWindow;
  return Boolean(browser.SpeechRecognition ?? browser.webkitSpeechRecognition);
};

export function useVoiceInput(onTranscript: (text: string) => void) {
  const supported = useSyncExternalStore(
    subscribe,
    voiceAvailable,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onTranscript);
  useEffect(() => {
    callback.current = onTranscript;
  }, [onTranscript]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) recognition.current?.stop();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      const active = recognition.current;
      if (active) {
        active.onresult = null;
        active.onerror = null;
        active.onend = null;
        active.abort();
      }
    };
  }, []);
  function stop() {
    recognition.current?.stop();
  }
  function start() {
    if (recognition.current) return;
    const browser = window as VoiceWindow;
    const Constructor =
      browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) {
      setError(
        "Voice input is unavailable in this browser. You can still type your request.",
      );
      return;
    }
    const active = new Constructor();
    recognition.current = active;
    active.lang = "en-IN";
    active.continuous = false;
    active.interimResults = true;
    active.onresult = (event) => {
      callback.current(
        Array.from(event.results)
          .map((result) => result[0].transcript)
          .join(" "),
      );
    };
    active.onerror = (event) => {
      const messages: Record<string, string> = {
        "not-allowed":
          "Microphone access was denied. Allow it in your browser settings or type your request.",
        "service-not-allowed":
          "Your browser does not allow speech recognition here. Type your request instead.",
        "audio-capture":
          "No microphone was found. Connect one or type your request.",
        "no-speech": "No speech was detected. Try again or type your request.",
        network:
          "Speech recognition could not connect. Try again or type your request.",
      };
      if (event.error !== "aborted")
        setError(
          messages[event.error] ?? `Voice input stopped: ${event.error}.`,
        );
    };
    active.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    try {
      setError("");
      active.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setListening(false);
      setError(
        "Could not start the microphone. Try again or type your request.",
      );
    }
  }
  return { supported, listening, error, start, stop };
}
