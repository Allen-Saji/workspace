"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Icon, Modal } from "./primitives";
import RobotSprite, { type RobotPose } from "./RobotSprite";
import {
  defaultPreferences,
  movePet,
  petBounds,
  readPetPreferences,
  type PetPosition,
  type PetPreferences,
  type PetReaction,
} from "./companion-state";
import styles from "./Companion.module.css";

const memory = new Map<string, string>();
const preferenceEvent = "workspace-pet-preferences";
function subscribePreferences(callback: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key) memory.delete(event.key);
    callback();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(preferenceEvent, callback);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(preferenceEvent, callback);
  };
}
function readPreferences(key: string) {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return memory.get(key) ?? "";
  }
}
function storePreferences(key: string, value: PetPreferences) {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(key, raw);
    memory.delete(key);
  } catch {
    memory.set(key, raw);
  }
  window.dispatchEvent(new Event(preferenceEvent));
}
function subscribeMotion(callback: () => void) {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function subscribeVisibility(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}
function pageVisible() {
  return document.visibilityState === "visible";
}
function subscribeViewport(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}
function viewportSnapshot() {
  return `${document.documentElement.clientWidth}:${window.innerHeight}`;
}
function ControlIcon({ kind }: { kind: "move" | "minimize" | "hide" }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "move" ? (
        <path d="M10 2v16M2 10h16M7 5l3-3 3 3M7 15l3 3 3-3M5 7l-3 3 3 3M15 7l3 3-3 3" />
      ) : kind === "minimize" ? (
        <path d="M4 10h12" />
      ) : (
        <path d="m5 5 10 10M15 5 5 15" />
      )}
    </svg>
  );
}

export default function Companion({
  workspaceId,
  busy,
  reaction,
  onAsk,
}: {
  workspaceId: string;
  busy: boolean;
  reaction: PetReaction | null;
  onAsk?: () => void;
}) {
  const key = `workspace-companion-v1:${workspaceId}`;
  const snapshot = useSyncExternalStore(
    subscribePreferences,
    useCallback(() => readPreferences(key), [key]),
    () => "",
  );
  const reduced = useSyncExternalStore(
    subscribeMotion,
    reducedMotion,
    () => true,
  );
  const visible = useSyncExternalStore(
    subscribeVisibility,
    pageVisible,
    () => true,
  );
  const viewport = useSyncExternalStore(
    subscribeViewport,
    viewportSnapshot,
    () => "1280:800",
  );
  const [width, height] = viewport.split(":").map(Number);
  const preferences = useMemo(
    () => readPetPreferences(snapshot, width < 700),
    [snapshot, width],
  );
  const [settings, setSettings] = useState(false),
    [waving, setWaving] = useState(false);
  const [expiredReaction, setExpiredReaction] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<PetPosition | null>(null);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    origin: PetPosition;
    latest: PetPosition;
  } | null>(null);
  const helpId = useId();
  const update = (change: Partial<PetPreferences>) =>
    storePreferences(key, { ...preferences, ...change });
  const minimized = width < 700 || preferences.visibility === "minimized";
  const bounds = petBounds({ width, height }, minimized);
  const position = dragPosition ?? preferences.position;
  const activeReaction =
    reaction && reaction.id !== expiredReaction ? reaction.kind : null;
  const moving =
    visible && !preferences.paused && !reduced && !dragPosition && !settings;
  const pose: RobotPose = !moving
    ? "idle"
    : busy
      ? "working"
      : activeReaction === "celebrate"
        ? "celebrate"
        : waving
          ? "wave"
          : activeReaction === "saved"
            ? "saved"
            : "idle";
  const message = busy
    ? "Working..."
    : activeReaction === "celebrate"
      ? "Completed"
      : activeReaction === "saved"
        ? "Saved."
        : "";
  useEffect(() => {
    if (!reaction) return;
    const timer = setTimeout(() => setExpiredReaction(reaction.id), 2600);
    return () => clearTimeout(timer);
  }, [reaction]);
  useEffect(() => {
    if (!waving) return;
    const timer = setTimeout(() => setWaving(false), 2100);
    return () => clearTimeout(timer);
  }, [waving]);
  function startDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: position,
      latest: position,
    };
    setDragPosition(position);
  }
  function onDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    active.latest = movePet(
      active.origin,
      event.clientX - active.x,
      event.clientY - active.y,
      bounds,
    );
    setDragPosition(active.latest);
  }
  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!drag.current || drag.current.pointer !== event.pointerId) return;
    update({ position: drag.current.latest });
    drag.current = null;
    setDragPosition(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function moveWithKeys(event: React.KeyboardEvent<HTMLButtonElement>) {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (event.key === "Home") {
      event.preventDefault();
      update({ position: defaultPreferences.position });
      return;
    }
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const distance = event.shiftKey ? 48 : 16;
    update({
      position: movePet(
        position,
        step[0] * distance,
        step[1] * distance,
        bounds,
      ),
    });
  }
  return (
    <>
      <button
        className="text-button pet-settings-trigger"
        onClick={() => setSettings(true)}
        aria-haspopup="dialog"
        aria-label="Companion appearance"
      >
        <Icon name="agents" />
        <span>Appearance</span>
      </button>
      {preferences.visibility === "hidden" && onAsk ? (
        <button className="text-button" onClick={onAsk}>
          Assistant
        </button>
      ) : null}
      {preferences.visibility !== "hidden" ? (
        <aside
          aria-label="Robot companion"
          className={`${styles.companion} ${minimized ? styles.minimized : ""}`}
          data-motion={moving ? "on" : "off"}
          data-reaction={activeReaction ?? "idle"}
          style={{
            left: 12 + position.x * bounds.x,
            top: 12 + position.y * bounds.y,
          }}
        >
          {minimized ? (
            <button
              className={styles.restore}
              onClick={() =>
                onAsk ? onAsk() : update({ visibility: "shown" })
              }
              aria-label={
                onAsk ? "Open workspace assistant" : "Restore robot companion"
              }
              onKeyDown={moveWithKeys}
            >
              <RobotSprite />
            </button>
          ) : (
            <>
              <div className={styles.message} role="status">
                {message}
              </div>
              <div className={styles.controls}>
                <button
                  aria-label="Move companion"
                  aria-describedby={helpId}
                  className={styles.move}
                  onPointerDown={startDrag}
                  onPointerMove={onDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onLostPointerCapture={() => {
                    drag.current = null;
                    setDragPosition(null);
                  }}
                  onKeyDown={moveWithKeys}
                >
                  <ControlIcon kind="move" />
                </button>
                <button
                  aria-label="Minimize companion"
                  onClick={() => update({ visibility: "minimized" })}
                >
                  <ControlIcon kind="minimize" />
                </button>
                <button
                  aria-label="Hide companion"
                  onClick={() => update({ visibility: "hidden" })}
                >
                  <ControlIcon kind="hide" />
                </button>
              </div>
              <span id={helpId} className="sr-only">
                Drag to move. Or use arrow keys, Shift for larger steps, and
                Home to reset.
              </span>
              <button
                className={styles.character}
                aria-label={
                  onAsk ? "Open workspace assistant" : "Robot companion"
                }
                onClick={() => {
                  setWaving(true);
                  onAsk?.();
                }}
              >
                <RobotSprite pose={pose} animated={moving} />
                <span className={styles.pixel} />
              </button>
              <span className={styles.shadow} aria-hidden="true" />
            </>
          )}
        </aside>
      ) : null}
      {settings ? (
        <Modal title="Companion appearance" onClose={() => setSettings(false)}>
          <div className={styles.settingsIntro}>
            <div>
              <RobotSprite pose="wave" />
            </div>
            <p>Click the companion to open your assistant.</p>
          </div>
          <label>
            <input
              type="checkbox"
              checked={preferences.visibility !== "hidden"}
              onChange={(event) =>
                update({
                  visibility: event.target.checked ? "shown" : "hidden",
                })
              }
            />
            Show companion
          </label>
          <label>
            <input
              type="checkbox"
              checked={!preferences.paused}
              onChange={(event) => update({ paused: !event.target.checked })}
            />
            Animate companion
          </label>
          {reduced ? (
            <p className="muted small">
              Your device prefers reduced motion, so the robot stays still.
            </p>
          ) : null}
          <footer className="form-actions">
            <button
              className="secondary"
              onClick={() =>
                update({
                  position: defaultPreferences.position,
                  visibility: "shown",
                })
              }
            >
              Reset position
            </button>
            <button className="primary" onClick={() => setSettings(false)}>
              Done
            </button>
          </footer>
        </Modal>
      ) : null}
    </>
  );
}
