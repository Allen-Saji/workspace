"use client";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceRecord } from "../domain/contracts";
import {
  focusTime,
  nextFocusPhase,
  phaseLabels,
  remainingFocusMs,
  type FocusPhase,
  type FocusSettings,
} from "./focus-state";
import { useFocusTimer } from "./useFocusTimer";
import FocusTimerIcon from "./FocusTimerIcon";
import styles from "./FocusPanel.module.css";

const phases: FocusPhase[] = ["focus", "short", "long"];

function TimerSettings({
  settings,
  locked,
  onSave,
}: {
  settings: FocusSettings;
  locked: boolean;
  onSave: (settings: FocusSettings) => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <form
      className={styles.settings}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSave({
          ...settings,
          focus: Number(form.get("focus")),
          short: Number(form.get("short")),
          long: Number(form.get("long")),
        });
        setSaved(true);
      }}
      onChange={() => setSaved(false)}
    >
      <fieldset disabled={locked}>
        <legend>Duration in minutes</legend>
        <div className={styles.durations}>
          {phases.map((phase) => (
            <label key={phase}>
              {phaseLabels[phase]}
              <input
                key={`${phase}:${settings[phase]}`}
                name={phase}
                type="number"
                min="1"
                max="120"
                step="1"
                required
                defaultValue={settings[phase]}
              />
            </label>
          ))}
        </div>
        <button className="secondary" type="submit">
          Save durations
        </button>
      </fieldset>
      <p className={styles.small}>
        {locked
          ? "Reset the current interval to change its duration."
          : "A long break follows every four completed focus sessions."}
      </p>
      <span role="status" className={styles.small}>
        {saved ? "Durations saved." : ""}
      </span>
    </form>
  );
}

export default function FocusPanel({
  workspaceId,
  tasks,
  visible,
  immersive,
  onImmersive,
}: {
  workspaceId: string;
  tasks: WorkspaceRecord[];
  visible: boolean;
  immersive: boolean;
  onImmersive: (value: boolean) => void;
}) {
  const { state, now, dispatch, persistent } = useFocusTimer(workspaceId);
  const { run, settings } = state;
  const remaining = remainingFocusMs(run, now);
  const display = focusTime(remaining);
  const active = run.status === "running" || run.status === "paused";
  const complete = run.status === "complete";
  const cycleCount =
    complete && run.phase === "focus" && state.completed % 4 === 0
      ? 4
      : state.completed % 4;
  const next = nextFocusPhase(state);
  const audio = useRef<AudioContext | null>(null);
  const sounded = useRef("");
  const originalTitle = useRef<string | null>(null);
  const today = now ? new Date(now).toLocaleDateString() : "";
  const sessions = state.history.filter(
    (item) => new Date(item.completedAt).toLocaleDateString() === today,
  );
  const minutes = Math.round(
    sessions.reduce((sum, item) => sum + item.durationMs, 0) / 60_000,
  );
  const selectedTask = tasks.find((item) => item.id === run.taskId);
  const options = tasks.filter(
    (item) => item.data.status !== "done" || item.id === run.taskId,
  );

  useEffect(() => {
    originalTitle.current = document.title;
    return () => {
      if (originalTitle.current) document.title = originalTitle.current;
    };
  }, []);
  useEffect(() => {
    document.title =
      run.status === "ready"
        ? (originalTitle.current ?? document.title)
        : `${display} - ${phaseLabels[run.phase]}${run.status === "paused" ? " (paused)" : complete ? " complete" : ""} | Workspace`;
  }, [display, run.phase, run.status, complete]);
  useEffect(() => {
    if (!immersive) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onImmersive(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [immersive, onImmersive]);
  useEffect(() => {
    if (!complete || sounded.current === run.id) return;
    sounded.current = run.id;
    const context = audio.current;
    if (!settings.sound || !context || context.state !== "running") return;
    const tone = context.createOscillator();
    const volume = context.createGain();
    tone.type = "sine";
    tone.frequency.setValueAtTime(660, context.currentTime);
    tone.frequency.setValueAtTime(880, context.currentTime + 0.2);
    volume.gain.setValueAtTime(0, context.currentTime);
    volume.gain.linearRampToValueAtTime(0.12, context.currentTime + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.6);
    tone.connect(volume);
    volume.connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.65);
    tone.onended = () => {
      tone.disconnect();
      volume.disconnect();
    };
  }, [complete, run.id, settings.sound]);
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );

  function enableAudio() {
    if (!settings.sound || typeof window.AudioContext !== "function") return;
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {});
    } catch {
      /* Visual completion remains available when audio is unavailable. */
    }
  }
  function primaryAction() {
    enableAudio();
    void dispatch(
      run.status === "running"
        ? { type: "pause" }
        : { type: complete ? "next" : "start", id: crypto.randomUUID() },
    );
  }
  const primaryLabel =
    run.status === "running"
      ? "Pause timer"
      : run.status === "paused"
        ? "Resume timer"
        : complete
          ? `Start ${phaseLabels[next].toLowerCase()}`
          : `Start ${phaseLabels[run.phase].toLowerCase()}`;

  if (!visible)
    return run.status === "ready" ? null : (
      <aside className={styles.dock} aria-label="Focus timer">
        <a href="#focus">
          <FocusTimerIcon kind="timer" />
          <span>
            <strong>{display}</strong>
            <small>
              {complete
                ? "Interval complete"
                : run.status === "paused"
                  ? "Paused"
                  : phaseLabels[run.phase]}
            </small>
          </span>
        </a>
        <button
          onClick={primaryAction}
          aria-label={primaryLabel}
          title={primaryLabel}
        >
          <FocusTimerIcon kind={run.status === "running" ? "pause" : "play"} />
        </button>
        <span className={styles.screenReader} role="status">
          {complete
            ? `${phaseLabels[run.phase]} complete. Open Focus to continue.`
            : ""}
        </span>
      </aside>
    );

  return (
    <section
      className={`${styles.root} ${immersive ? styles.immersive : ""}`}
      aria-label="Pomodoro focus timer"
    >
      {immersive ? <h1 className={styles.screenReader}>Focus mode</h1> : null}
      <div className={styles.toolbar}>
        <div className={styles.eyebrow}>
          <FocusTimerIcon kind="timer" />
          <span>{immersive ? "Workspace / Focus" : "Focus timer"}</span>
        </div>
        <button
          className="secondary"
          aria-pressed={immersive}
          onClick={() => onImmersive(!immersive)}
        >
          <FocusTimerIcon kind={immersive ? "collapse" : "expand"} />
          {immersive ? "Exit focus mode" : "Enter focus mode"}
        </button>
      </div>
      {!persistent ? (
        <p role="alert" className="error">
          Browser storage is unavailable. This timer will be lost when you close
          or refresh the page.
        </p>
      ) : null}
      <div className={styles.layout}>
        <div className={styles.timerCard} data-phase={run.phase}>
          <div
            className={styles.phaseTabs}
            role="group"
            aria-label="Timer interval"
          >
            {phases.map((phase) => (
              <button
                key={phase}
                disabled={active}
                aria-pressed={run.phase === phase}
                onClick={() => void dispatch({ type: "phase", phase })}
              >
                {phaseLabels[phase]}
              </button>
            ))}
          </div>
          <div className={styles.dial}>
            <svg viewBox="0 0 360 360" aria-hidden="true">
              <circle className={styles.track} cx="180" cy="180" r="164" />
              <circle
                className={styles.arc}
                cx="180"
                cy="180"
                r="164"
                pathLength="100"
                strokeDasharray={`${Math.max(0, (remaining / run.durationMs) * 100)} 100`}
                transform="rotate(-90 180 180)"
              />
            </svg>
            <div className={styles.dialContent}>
              <span className={styles.eyebrow}>
                {complete
                  ? "Interval complete"
                  : run.status === "paused"
                    ? "On pause"
                    : phaseLabels[run.phase]}
              </span>
              <span
                className={styles.countdown}
                role="timer"
                aria-live="off"
                aria-label={`${phaseLabels[run.phase]} time remaining`}
              >
                {display}
              </span>
              <span className={styles.round}>
                {run.phase === "focus"
                  ? `Session ${((complete ? Math.max(0, state.completed - 1) : state.completed) % 4) + 1} of 4`
                  : "Step away for a moment"}
              </span>
            </div>
          </div>
          <div className={styles.timerActions}>
            <button
              className={`primary ${styles.start}`}
              onClick={primaryAction}
            >
              <FocusTimerIcon
                kind={run.status === "running" ? "pause" : "play"}
              />
              {primaryLabel}
            </button>
            <button
              className={`secondary ${styles.reset}`}
              disabled={run.status === "ready"}
              onClick={() => void dispatch({ type: "reset" })}
            >
              <FocusTimerIcon kind="reset" />
              Reset
            </button>
          </div>
          <div className={styles.message} role="status">
            {complete
              ? run.phase === "focus"
                ? `Session saved. Your ${phaseLabels[next].toLowerCase()} is ready when you are.`
                : "Break complete. Ready for another focus session?"
              : run.status === "paused"
                ? "Take your time. Resume when you are ready."
                : run.status === "running"
                  ? run.phase === "focus"
                    ? "Focus session in progress."
                    : "Break in progress."
                  : "Choose a task or enter a session goal."}
          </div>
          <div
            className={styles.cycle}
            aria-label={`${cycleCount} of four focus sessions completed in this cycle`}
          >
            {[0, 1, 2, 3].map((index) => (
              <span key={index} data-filled={index < cycleCount} />
            ))}
            <small>Long break every 4 sessions</small>
          </div>
        </div>
        <div className={styles.sidebar}>
          <section className={styles.intentionCard}>
            <span className={styles.eyebrow}>Session goal</span>
            <h2>
              {active
                ? run.label || "Focus session"
                : "What needs your attention?"}
            </h2>
            <label htmlFor="focus-task">
              Link a task <span className={styles.small}>(optional)</span>
            </label>
            <select
              id="focus-task"
              value={run.taskId ?? ""}
              disabled={active}
              onChange={(event) => {
                const target = tasks.find(
                  (item) => item.id === event.target.value,
                );
                void dispatch({
                  type: "target",
                  taskId: target?.id ?? null,
                  label: target ? String(target.data.title) : "",
                });
              }}
            >
              <option value="">No linked task</option>
              {run.taskId && !selectedTask ? (
                <option value={run.taskId}>
                  Previously linked task (unavailable)
                </option>
              ) : null}
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {String(item.data.title)}
                  {item.data.status === "done" ? " (completed)" : ""}
                </option>
              ))}
            </select>
            <label htmlFor="focus-intention">Your intention</label>
            <textarea
              id="focus-intention"
              rows={3}
              maxLength={300}
              value={run.label}
              disabled={active}
              placeholder="What will you work on?"
              onChange={(event) =>
                void dispatch({
                  type: "target",
                  taskId: run.taskId,
                  label: event.target.value,
                })
              }
            />
            <p className={styles.small}>
              {active
                ? "Reset the interval to choose a different task."
                : "Finishing a session leaves the task's status unchanged."}
            </p>
          </section>
          <section className={styles.summaryCard} aria-label="Today's focus">
            <h2>Today&apos;s focus</h2>
            <div className={styles.stats}>
              <div>
                <strong>{sessions.length}</strong>
                <span>sessions</span>
              </div>
              <div>
                <strong>
                  {minutes}
                  <small> min</small>
                </strong>
                <span>focused</span>
              </div>
            </div>
          </section>
          <details className={styles.preferences}>
            <summary>Timer preferences</summary>
            <TimerSettings
              settings={settings}
              locked={active}
              onSave={(value) =>
                void dispatch({ type: "settings", settings: value })
              }
            />
            <label className={styles.sound}>
              <input
                type="checkbox"
                checked={settings.sound}
                onChange={(event) => {
                  if (
                    event.target.checked &&
                    typeof window.AudioContext === "function"
                  ) {
                    try {
                      audio.current ??= new AudioContext();
                      void audio.current.resume().catch(() => {});
                    } catch {
                      /* Sound is optional. */
                    }
                  }
                  void dispatch({
                    type: "settings",
                    settings: { ...settings, sound: event.target.checked },
                  });
                }}
              />
              Play a gentle completion sound
            </label>
            <p className={styles.small}>
              Keep the app open for the completion cue. Suspended tabs catch up
              when reopened; the next interval starts only when you choose.
            </p>
          </details>
        </div>
      </div>
      {!immersive ? (
        <section className={styles.history} aria-label="Recent focus sessions">
          <div>
            <h2>Recent sessions</h2>
            <span className={styles.small}>
              Last 5 completed focus intervals
            </span>
          </div>
          {state.history.length ? (
            <ol>
              {state.history
                .slice(-5)
                .reverse()
                .map((item) => (
                  <li key={item.id}>
                    <span className={styles.sessionMark} aria-hidden="true">
                      <FocusTimerIcon kind="check" />
                    </span>
                    <div>
                      <strong>{item.label || "Focus session"}</strong>
                      <time dateTime={new Date(item.completedAt).toISOString()}>
                        {new Date(item.completedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <span>{Math.round(item.durationMs / 60_000)} min</span>
                  </li>
                ))}
            </ol>
          ) : (
            <p className={styles.empty}>
              Your first completed session will appear here.
            </p>
          )}
        </section>
      ) : null}
    </section>
  );
}
