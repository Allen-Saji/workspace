export type FocusPhase = "focus" | "short" | "long";
export type FocusStatus = "ready" | "running" | "paused" | "complete";
export type FocusSettings = {
  focus: number;
  short: number;
  long: number;
  sound: boolean;
};
export type FocusRun = {
  id: string;
  phase: FocusPhase;
  status: FocusStatus;
  durationMs: number;
  remainingMs: number;
  endsAt: number | null;
  taskId: string | null;
  label: string;
};
export type FocusSession = Pick<
  FocusRun,
  "id" | "durationMs" | "taskId" | "label"
> & { completedAt: number };
export type FocusState = {
  version: 1;
  settings: FocusSettings;
  run: FocusRun;
  completed: number;
  history: FocusSession[];
};
export type FocusAction =
  | { type: "start" | "next"; id: string }
  | { type: "pause" | "reset" }
  | { type: "phase"; phase: FocusPhase }
  | { type: "target"; taskId: string | null; label: string }
  | { type: "settings"; settings: FocusSettings };

export const phaseLabels: Record<FocusPhase, string> = {
  focus: "Focus",
  short: "Short break",
  long: "Long break",
};
export const defaultFocusSettings: FocusSettings = {
  focus: 25,
  short: 5,
  long: 15,
  sound: false,
};
const minute = 60_000;
const maximumDuration = 120 * minute;
const timestamp = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isSafeInteger(v) &&
  v > 0 &&
  v <= 8_640_000_000_000_000;
const duration = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isSafeInteger(v) &&
  v >= minute &&
  v <= maximumDuration;
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max;
const task = (v: unknown): v is string | null =>
  v === null || (text(v, 200) && v.length > 0);
const phases: FocusPhase[] = ["focus", "short", "long"];

export function validFocusSettings(value: FocusSettings) {
  return (
    [value.focus, value.short, value.long].every(
      (v) => Number.isInteger(v) && v >= 1 && v <= 120,
    ) && typeof value.sound === "boolean"
  );
}

function readyRun(
  settings: FocusSettings,
  phase: FocusPhase,
  previous?: FocusRun,
): FocusRun {
  const durationMs = settings[phase] * minute;
  return {
    id: "",
    phase,
    status: "ready",
    durationMs,
    remainingMs: durationMs,
    endsAt: null,
    taskId: previous?.taskId ?? null,
    label: previous?.label ?? "",
  };
}

export function newFocusState(): FocusState {
  const settings = { ...defaultFocusSettings };
  return {
    version: 1,
    settings,
    run: readyRun(settings, "focus"),
    completed: 0,
    history: [],
  };
}

// Browser storage is untrusted. Restore only a complete, bounded v1 snapshot.
export function readFocusState(raw: string): FocusState {
  try {
    if (raw.length > 250_000) return newFocusState();
    const value = JSON.parse(raw) as FocusState;
    const { settings, run, history } = value;
    if (
      value.version !== 1 ||
      !settings ||
      !validFocusSettings(settings) ||
      !run ||
      !phases.includes(run.phase) ||
      !["ready", "running", "paused", "complete"].includes(run.status) ||
      !text(run.id, 100) ||
      !task(run.taskId) ||
      !text(run.label, 300) ||
      !duration(run.durationMs) ||
      !Number.isSafeInteger(run.remainingMs) ||
      run.remainingMs < 0 ||
      run.remainingMs > run.durationMs ||
      !Number.isSafeInteger(value.completed) ||
      value.completed < 0 ||
      value.completed > 1_000_000 ||
      (run.status === "running"
        ? !timestamp(run.endsAt) || !run.id
        : run.endsAt !== null) ||
      (run.status === "ready" &&
        (run.id !== "" || run.remainingMs !== run.durationMs)) ||
      (run.status !== "ready" && !run.id) ||
      (run.status === "complete"
        ? run.remainingMs !== 0
        : run.remainingMs <= 0) ||
      !Array.isArray(history) ||
      history.length > 200 ||
      value.completed < history.length ||
      history.some(
        (item) =>
          !item ||
          !text(item.id, 100) ||
          !item.id ||
          !duration(item.durationMs) ||
          !timestamp(item.completedAt) ||
          !task(item.taskId) ||
          !text(item.label, 300),
      ) ||
      new Set(history.map((item) => item.id)).size !== history.length
    )
      return newFocusState();
    return {
      version: 1,
      settings: {
        focus: settings.focus,
        short: settings.short,
        long: settings.long,
        sound: settings.sound,
      },
      run: {
        id: run.id,
        phase: run.phase,
        status: run.status,
        durationMs: run.durationMs,
        remainingMs: run.remainingMs,
        endsAt: run.endsAt,
        taskId: run.taskId,
        label: run.label,
      },
      completed: value.completed,
      history: history.map(
        ({ id, durationMs, completedAt, taskId, label }) => ({
          id,
          durationMs,
          completedAt,
          taskId,
          label,
        }),
      ),
    };
  } catch {
    return newFocusState();
  }
}

export function remainingFocusMs(run: FocusRun, now: number) {
  return run.status === "running" && run.endsAt !== null
    ? Math.max(0, Math.min(run.durationMs, run.endsAt - now))
    : run.remainingMs;
}

// A deadline ends one interval. Sleeping or closing a tab never invents more sessions.
export function settleFocus(state: FocusState, now: number): FocusState {
  const { run } = state;
  if (run.status !== "running" || run.endsAt === null || run.endsAt > now)
    return state;
  const count =
    run.phase === "focus" && !state.history.some((item) => item.id === run.id);
  return {
    ...state,
    run: { ...run, status: "complete", remainingMs: 0, endsAt: null },
    completed: state.completed + (count ? 1 : 0),
    history: count
      ? [
          ...state.history,
          {
            id: run.id,
            durationMs: run.durationMs,
            taskId: run.taskId,
            label: run.label,
            completedAt: run.endsAt,
          },
        ].slice(-200)
      : state.history,
  };
}

export function nextFocusPhase(state: FocusState): FocusPhase {
  return state.run.phase !== "focus"
    ? "focus"
    : state.completed > 0 && state.completed % 4 === 0
      ? "long"
      : "short";
}

export function changeFocus(
  input: FocusState,
  action: FocusAction,
  now: number,
): FocusState {
  const state = settleFocus(input, now);
  const { run } = state;
  switch (action.type) {
    case "start":
      if (
        !["ready", "paused"].includes(run.status) ||
        !text(action.id, 100) ||
        !action.id
      )
        return state;
      return {
        ...state,
        run: {
          ...run,
          id: run.id || action.id,
          status: "running",
          endsAt: now + run.remainingMs,
        },
      };
    case "pause":
      return run.status === "running"
        ? {
            ...state,
            run: {
              ...run,
              status: "paused",
              remainingMs: remainingFocusMs(run, now),
              endsAt: null,
            },
          }
        : state;
    case "reset":
      return { ...state, run: readyRun(state.settings, run.phase, run) };
    case "next": {
      if (run.status !== "complete" || !text(action.id, 100) || !action.id)
        return state;
      const next = readyRun(state.settings, nextFocusPhase(state), run);
      return {
        ...state,
        run: {
          ...next,
          id: action.id,
          status: "running",
          endsAt: now + next.durationMs,
        },
      };
    }
    case "phase":
      return ["ready", "complete"].includes(run.status) &&
        phases.includes(action.phase)
        ? { ...state, run: readyRun(state.settings, action.phase, run) }
        : state;
    case "target":
      return ["ready", "complete"].includes(run.status) &&
        task(action.taskId) &&
        text(action.label, 300)
        ? {
            ...state,
            run: { ...run, taskId: action.taskId, label: action.label },
          }
        : state;
    case "settings":
      if (!validFocusSettings(action.settings)) return state;
      // Changing a preference must not change an interval already in progress.
      if (["running", "paused"].includes(run.status)) {
        return {
          ...state,
          settings: { ...state.settings, sound: action.settings.sound },
        };
      }
      return {
        ...state,
        settings: { ...action.settings },
        run:
          run.status === "ready"
            ? readyRun(action.settings, run.phase, run)
            : run,
      };
  }
}

export function focusTime(ms: number) {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
