import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { localPersonalJournal } from "../src/journal/personal-store.ts";
import {
  journalDate,
  personalWrite,
  preparePersonalJournal,
} from "../src/journal/personal.ts";
import { GET, POST } from "../app/api/journal/route.ts";

const entry = {
  requestId: "save-1",
  localDate: "2026-10-25",
  timezone: "Asia/Kolkata",
  content: "I finished the integration.\nTomorrow I will review it.",
  expectedRevision: 0,
};
test("personal journal preserves exact text, revisions and original save receipts across reopen", async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), "workspace-personal-")),
    "journal.sqlite",
  );
  let store = localPersonalJournal(path);
  const first = await store.save(entry);
  assert.equal(first.content, entry.content);
  assert.equal(first.revision, 1);
  const second = await store.save({
    ...entry,
    requestId: "save-2",
    content: "Revised personal entry.",
    expectedRevision: 1,
  });
  assert.equal(second.revision, 2);
  assert.deepEqual(await store.save(entry), first);
  await assert.rejects(
    store.save({ ...entry, content: "Changed retry" }),
    /idempotency_conflict/,
  );
  await assert.rejects(
    store.save({ ...entry, requestId: "stale" }),
    /journal_revision_conflict/,
  );
  await assert.rejects(
    store.save({
      ...entry,
      requestId: "zone",
      timezone: "UTC",
      expectedRevision: 2,
    }),
    /timezone_conflict/,
  );
  store.close();
  store = localPersonalJournal(path);
  try {
    assert.equal(
      (await store.day(entry.localDate)).entry?.content,
      second.content,
    );
    assert.equal((await store.day(entry.localDate)).recent.length, 1);
    assert.deepEqual(
      (await store.history(entry.localDate)).map((e) => e.revision),
      [2, 1],
    );
    assert.equal((await store.day("2026-10-24")).entry, null);
  } finally {
    store.close();
  }
});
test("mascot journal preparation appends to the owner entry without saving or changing it", async () => {
  const store = localPersonalJournal(
    join(mkdtempSync(join(tmpdir(), "workspace-personal-")), "journal.sqlite"),
  );
  try {
    const fresh = await preparePersonalJournal(
      store,
      "preview",
      entry.localDate,
      "My new dictation.",
      entry.timezone,
    );
    assert.equal(fresh.expectedRevision, 0);
    assert.equal((await store.day(entry.localDate)).entry, null);
    await store.save(entry);
    const preview = await preparePersonalJournal(
      store,
      "preview-2",
      entry.localDate,
      "My new dictation.",
      "UTC",
    );
    assert.equal(preview.content, entry.content + "\n\nMy new dictation.");
    assert.equal(preview.timezone, "Asia/Kolkata");
    assert.equal(preview.expectedRevision, 1);
    assert.equal((await store.day(entry.localDate)).entry?.revision, 1);
  } finally {
    store.close();
  }
});
test("journal validators reject fabricated dates, oversized content, future days and owner overrides", () => {
  assert.throws(() => journalDate("2026-02-30"), /invalid_date/);
  assert.throws(
    () => journalDate("2026-10-25T00:00:00Z"),
    /invalid_text|invalid_date/,
  );
  assert.throws(
    () => personalWrite({ ...entry, content: " " }),
    /invalid_text/,
  );
  assert.throws(
    () => personalWrite({ ...entry, content: "x".repeat(12001) }),
    /invalid_text/,
  );
  assert.throws(
    () => personalWrite({ ...entry, timezone: "Mars/Olympus" }),
    /invalid_timezone/,
  );
  assert.throws(
    () => personalWrite({ ...entry, expectedRevision: -1 }),
    /invalid_revision/,
  );
  assert.throws(
    () => personalWrite({ ...entry, workspaceId: "foreign" }),
    /unknown_field/,
  );
  assert.throws(
    () => personalWrite({ ...entry, localDate: "2099-01-01" }),
    /journal_future_date/,
  );
});
test("journal HTTP rejects forged hosts, cross-origin writes and workspace selectors before storage", async () => {
  const badHost = await GET(
    new Request("http://127.0.0.1:3210/api/journal?date=2026-10-25", {
      headers: { host: "evil.example" },
    }),
  );
  assert.equal(badHost.status, 403);
  const crossOrigin = await POST(
    new Request("http://127.0.0.1:3210/api/journal", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3210",
        origin: "https://evil.example",
        "content-type": "application/json",
        "x-workspace-request": "local-ui",
      },
      body: JSON.stringify({ action: "save", entry }),
    }),
  );
  assert.equal(crossOrigin.status, 403);
  const selector = await GET(
    new Request(
      "http://127.0.0.1:3210/api/journal?date=2026-10-25&workspaceId=other",
      { headers: { host: "127.0.0.1:3210" } },
    ),
  );
  assert.equal(selector.status, 422);
});
