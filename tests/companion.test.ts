import test from "node:test";
import assert from "node:assert/strict";
import {
  readPetPreferences,
  movePet,
  petBounds,
  reactionForSave,
} from "../src/ui/companion-state.ts";

test("corrupt companion preferences recover without off-screen positions", () => {
  for (const raw of ["invalid", "null", "false", "[]"]) {
    const result = readPetPreferences(raw);
    assert.equal(result.visibility, "shown");
    assert.equal(result.paused, false);
    assert.deepEqual(result.position, { x: 0, y: 1 });
  }
  assert.deepEqual(
    readPetPreferences(
      JSON.stringify({
        visibility: "hidden",
        paused: true,
        position: { x: -999, y: 999 },
      }),
    ),
    {
      visibility: "hidden",
      paused: true,
      position: { x: 0, y: 1 },
    },
  );
  assert.equal(
    readPetPreferences(
      '{"position":{"x":"0","y":null},"visibility":"surprise"}',
    ).visibility,
    "shown",
  );
});

test("pet movement stays reachable on phones and after desktop resizing", () => {
  for (const size of [
    { width: 320, height: 568 },
    { width: 1440, height: 900 },
    { width: 180, height: 200 },
  ]) {
    for (const minimized of [false, true]) {
      const bounds = petBounds(size, minimized);
      const position = movePet({ x: 0.5, y: 0.5 }, -10000, 10000, bounds);
      assert.ok(position.x >= 0 && position.x <= 1);
      assert.ok(position.y >= 0 && position.y <= 1);
      assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y));
      const left = 12 + position.x * bounds.x;
      assert.ok(left >= 12 && left + (minimized ? 48 : 152) <= size.width - 12);
    }
  }
});

test("only a newly completed task or lesson gets a celebration", () => {
  assert.equal(
    reactionForSave(
      { kind: "task", data: { status: "done" } },
      { data: { status: "ready" } },
    ),
    "celebrate",
  );
  assert.equal(
    reactionForSave(
      { kind: "lesson", data: { status: "completed" } },
      { data: { status: "in_progress" } },
    ),
    "celebrate",
  );
  assert.equal(
    reactionForSave({ kind: "task", data: { status: "done" } }, undefined),
    "celebrate",
  );
  assert.equal(
    reactionForSave(
      { kind: "task", data: { status: "done" } },
      { data: { status: "done" } },
    ),
    "saved",
  );
  assert.equal(
    reactionForSave(
      { kind: "task", data: { status: "ready" } },
      { data: { status: "done" } },
    ),
    "saved",
  );
  assert.equal(
    reactionForSave({ kind: "note", data: { status: "done" } }, undefined),
    "saved",
  );
  assert.equal(reactionForSave(null, undefined), "saved");
});

test("phone default is minimized while an explicit choice survives resizing", () => {
  assert.equal(readPetPreferences("", true).visibility, "minimized");
  assert.equal(readPetPreferences("", false).visibility, "shown");
  const chosen = JSON.stringify({
    visibility: "shown",
    paused: true,
    position: { x: 0.3, y: 0.4 },
  });
  assert.deepEqual(
    readPetPreferences(chosen, true),
    readPetPreferences(chosen, false),
  );
});
