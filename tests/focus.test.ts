import test from "node:test";
import assert from "node:assert/strict";
import {
  changeFocus,
  focusTime,
  newFocusState,
  nextFocusPhase,
  readFocusState,
  remainingFocusMs,
  settleFocus,
  type FocusState,
} from "../src/ui/focus-state.ts";

const now = Date.UTC(2026, 9, 26, 10);
const minute = 60_000;

test("focus follows an absolute deadline across reloads and delayed browser ticks", () => {
  const started = changeFocus(
    newFocusState(),
    { type: "start", id: "focus-1" },
    now,
  );
  const restored = readFocusState(JSON.stringify(started));
  assert.equal(
    remainingFocusMs(restored.run, now + 7 * minute + 123),
    18 * minute - 123,
  );
  const finished = settleFocus(restored, now + 6 * 60 * minute);
  assert.equal(finished.run.status, "complete");
  assert.equal(finished.completed, 1);
  assert.equal(finished.history.length, 1);
  assert.equal(finished.history[0].completedAt, now + 25 * minute);
  assert.equal(finished.history[0].durationMs, 25 * minute);
  assert.deepEqual(settleFocus(finished, now + 24 * 60 * minute), finished);
});

test("pausing preserves exact remaining time and resumes with the same session identity", () => {
  let state = changeFocus(
    newFocusState(),
    { type: "start", id: "original" },
    now,
  );
  state = changeFocus(state, { type: "pause" }, now + 1_234);
  assert.equal(state.run.remainingMs, 25 * minute - 1_234);
  assert.equal(state.run.endsAt, null);
  assert.equal(
    remainingFocusMs(state.run, now + 60 * minute),
    state.run.remainingMs,
  );
  state = readFocusState(JSON.stringify(state));
  state = changeFocus(
    state,
    { type: "start", id: "ignored" },
    now + 60 * minute,
  );
  assert.equal(state.run.id, "original");
  assert.equal(state.run.endsAt, now + 85 * minute - 1_234);
  assert.equal(settleFocus(state, state.run.endsAt!).completed, 1);
});

test("a pause or reset at the deadline records completion once without discarding history", () => {
  const started = changeFocus(
    newFocusState(),
    { type: "start", id: "edge" },
    now,
  );
  const paused = changeFocus(started, { type: "pause" }, now + 25 * minute);
  assert.equal(paused.run.status, "complete");
  assert.equal(paused.completed, 1);
  const reset = changeFocus(paused, { type: "reset" }, now + 26 * minute);
  assert.equal(reset.run.status, "ready");
  assert.equal(reset.run.remainingMs, 25 * minute);
  assert.equal(reset.history.length, 1);
  const abandoned = changeFocus(started, { type: "reset" }, now + minute);
  assert.equal(abandoned.completed, 0);
  assert.equal(abandoned.history.length, 0);
});

test("four completed focus sessions lead to a long break, and breaks do not count as work", () => {
  let state = newFocusState();
  let at = now;
  for (let round = 1; round <= 4; round++) {
    state = changeFocus(state, { type: "start", id: `focus-${round}` }, at);
    at += 25 * minute;
    state = settleFocus(state, at);
    assert.equal(nextFocusPhase(state), round === 4 ? "long" : "short");
    state = changeFocus(state, { type: "next", id: `break-${round}` }, at);
    assert.equal(state.run.phase, round === 4 ? "long" : "short");
    at += state.run.durationMs;
    state = settleFocus(state, at);
    assert.equal(state.completed, round);
    assert.equal(state.history.length, round);
    assert.equal(nextFocusPhase(state), "focus");
    state = changeFocus(state, { type: "phase", phase: "focus" }, at);
  }
  assert.equal(state.run.status, "ready");
});

test("task and intention are snapshotted while a running or paused session stays locked", () => {
  let state = changeFocus(
    newFocusState(),
    { type: "target", taskId: "task-1", label: "Read the design" },
    now,
  );
  state = changeFocus(state, { type: "start", id: "linked" }, now);
  const original = state;
  assert.deepEqual(
    changeFocus(
      state,
      { type: "target", taskId: "other", label: "Changed" },
      now,
    ),
    original,
  );
  assert.deepEqual(
    changeFocus(state, { type: "phase", phase: "long" }, now),
    original,
  );
  const finished = settleFocus(state, now + 25 * minute);
  assert.equal(finished.history[0].taskId, "task-1");
  assert.equal(finished.history[0].label, "Read the design");
  assert.equal(finished.run.taskId, "task-1");
  assert.ok(!("records" in finished));
});

test("duration preferences apply to new intervals and cannot silently extend running work", () => {
  const settings = { focus: 45, short: 10, long: 20, sound: true };
  let state = changeFocus(newFocusState(), { type: "settings", settings }, now);
  assert.equal(state.run.durationMs, 45 * minute);
  state = changeFocus(state, { type: "start", id: "custom" }, now);
  const changed = changeFocus(
    state,
    {
      type: "settings",
      settings: { focus: 120, short: 1, long: 1, sound: false },
    },
    now + minute,
  );
  assert.equal(changed.run.endsAt, state.run.endsAt);
  assert.equal(changed.settings.focus, 45);
  assert.equal(changed.settings.sound, false);
  assert.equal(
    changeFocus(
      state,
      { type: "settings", settings: { ...settings, focus: 0 } },
      now,
    ),
    state,
  );
  assert.equal(
    changeFocus(
      state,
      { type: "settings", settings: { ...settings, focus: 1.5 } },
      now,
    ),
    state,
  );
});

test("corrupt and oversized browser snapshots cannot restore invalid timer state", () => {
  for (const raw of [
    "",
    "invalid",
    "null",
    "[]",
    "false",
    "x".repeat(250_001),
  ]) {
    assert.deepEqual(readFocusState(raw), newFocusState());
  }
  const state = changeFocus(
    newFocusState(),
    { type: "start", id: "valid" },
    now,
  );
  const invalid: FocusState[] = [
    { ...state, version: 2 } as unknown as FocusState,
    { ...state, settings: { ...state.settings, focus: 121 } },
    { ...state, run: { ...state.run, endsAt: null } },
    { ...state, run: { ...state.run, remainingMs: -1 } },
    { ...state, run: { ...state.run, label: "x".repeat(301) } },
    { ...state, completed: -1 },
  ];
  for (const value of invalid)
    assert.deepEqual(readFocusState(JSON.stringify(value)), newFocusState());
  const finished = settleFocus(state, now + 25 * minute);
  const duplicate = {
    ...finished,
    completed: 2,
    history: [...finished.history, ...finished.history],
  };
  assert.deepEqual(readFocusState(JSON.stringify(duplicate)), newFocusState());
  assert.deepEqual(readFocusState(JSON.stringify(finished)), finished);
});

test("history stays bounded without losing the break cadence and countdown never goes negative", () => {
  let state = newFocusState();
  for (let i = 0; i < 205; i++) {
    state = changeFocus(state, { type: "start", id: `session-${i}` }, now);
    state = settleFocus(state, now + 25 * minute);
    state = changeFocus(state, { type: "phase", phase: "focus" }, now);
  }
  assert.equal(state.completed, 205);
  assert.equal(state.history.length, 200);
  assert.equal(state.history[0].id, "session-5");
  assert.deepEqual(readFocusState(JSON.stringify(state)), state);
  assert.equal(focusTime(25 * minute), "25:00");
  assert.equal(focusTime(1), "00:01");
  assert.equal(focusTime(-100), "00:00");
});
