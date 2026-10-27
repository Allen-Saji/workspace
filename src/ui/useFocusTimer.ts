"use client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  changeFocus,
  readFocusState,
  settleFocus,
  type FocusAction,
} from "./focus-state";

const updateEvent = "workspace-focus-update";
const fallback = new Map<string, string>();
const unavailable = new Set<string>();
let clockTime = 0;

function read(key: string) {
  if (fallback.has(key)) return fallback.get(key)!;
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    unavailable.add(key);
    return "";
  }
}
function write(key: string, raw: string) {
  try {
    localStorage.setItem(key, raw);
    fallback.delete(key);
    unavailable.delete(key);
  } catch {
    fallback.set(key, raw);
    unavailable.add(key);
  }
  clockTime = Date.now();
  window.dispatchEvent(new CustomEvent(updateEvent, { detail: key }));
}
function subscribe(key: string, notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      fallback.delete(key);
      notify();
    }
  };
  const local = (event: Event) => {
    if ((event as CustomEvent).detail === key) notify();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(updateEvent, local);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(updateEvent, local);
  };
}
function subscribeClock(notify: () => void) {
  const tick = () => {
    clockTime = Date.now();
    notify();
  };
  clockTime = Date.now();
  const interval = setInterval(tick, 1000);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("focus", tick);
  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", tick);
    window.removeEventListener("focus", tick);
  };
}
const clock = () => clockTime;

export function useFocusTimer(workspaceId: string) {
  const key = `workspace-focus-v1:${workspaceId}`;
  const raw = useSyncExternalStore(
    useCallback((notify) => subscribe(key, notify), [key]),
    useCallback(() => read(key), [key]),
    () => "",
  );
  const state = useMemo(() => readFocusState(raw), [raw]);
  const now = useSyncExternalStore(subscribeClock, clock, () => 0);
  const mutate = useCallback(
    async (action: FocusAction | null, expectedId: string) => {
      const update = () => {
        const original = read(key);
        const current = readFocusState(original);
        if (current.run.id !== expectedId) return;
        const next = action
          ? changeFocus(current, action, Date.now())
          : settleFocus(current, Date.now());
        const result = JSON.stringify(next);
        if (result !== JSON.stringify(current)) write(key, result);
      };
      // Serialize commands from tabs sharing this origin. Never hold a lock while waiting on UI.
      if (navigator.locks) {
        try {
          await navigator.locks.request(key, update);
        } catch {
          update();
        }
      } else update();
    },
    [key],
  );
  useEffect(() => {
    if (
      state.run.status === "running" &&
      state.run.endsAt !== null &&
      state.run.endsAt <= now
    ) {
      void mutate(null, state.run.id);
    }
  }, [state.run.status, state.run.endsAt, state.run.id, now, mutate]);
  const dispatch = (action: FocusAction) => mutate(action, state.run.id);
  return { state, now, dispatch, persistent: !unavailable.has(key) };
}
