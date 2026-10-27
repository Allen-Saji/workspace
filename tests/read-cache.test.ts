import test from "node:test";
import assert from "node:assert/strict";
import { ReadCache } from "../src/ui/read-cache.ts";

test("reads are shared across section consumers until expiry or invalidation", async () => {
  let now = 0,
    calls = 0;
  const cache = new ReadCache<number>(60000, 10, () => now);
  const load = async () => ++calls;
  assert.deepEqual(
    await Promise.all([
      cache.read("0:agents", load),
      cache.read("0:agents", load),
    ]),
    [1, 1],
  );
  assert.equal(await cache.read("0:agents", load), 1);
  now = 60000;
  assert.equal(await cache.read("0:agents", load), 2);
  cache.invalidate("0:agents");
  assert.equal(await cache.read("0:agents", load), 3);
  assert.equal(await cache.read("1:agents", load), 4);
});

test("leaving one section does not cancel shared readers or the cache fill", async () => {
  const cache = new ReadCache<string>();
  const leaving = new AbortController();
  let finish!: (value: string) => void;
  const load = () =>
    new Promise<string>((resolve) => {
      finish = resolve;
    });
  const first = cache.read("agents", load, leaving.signal);
  const second = cache.read("agents", load);
  await Promise.resolve();
  leaving.abort();
  await assert.rejects(first, { name: "AbortError" });
  finish("saved agents");
  assert.equal(await second, "saved agents");
  assert.equal(cache.peek("agents"), "saved agents");
});

test("invalidation blocks an older response from replacing a newer save", async () => {
  const cache = new ReadCache<string>();
  let finish!: (value: string) => void;
  let oldSignal!: AbortSignal;
  const old = cache.read("journal", (signal) => {
    oldSignal = signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await Promise.resolve();
  cache.invalidate("journal");
  assert.equal(oldSignal.aborted, true);
  assert.equal(
    await cache.read("journal", async () => "new revision"),
    "new revision",
  );
  finish("old revision");
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(cache.peek("journal"), "new revision");
});

test("failed reads are retried, LRU is bounded, and workspace instances are isolated", async () => {
  const cache = new ReadCache<string>(60000, 2);
  await assert.rejects(
    cache.read("a", async () => {
      throw new Error("unavailable");
    }),
  );
  assert.equal(await cache.read("a", async () => "owner A"), "owner A");
  await cache.read("b", async () => "b");
  cache.peek("a");
  await cache.read("c", async () => "c");
  assert.equal(cache.peek("b"), undefined);
  const other = new ReadCache<string>();
  assert.equal(other.peek("a"), undefined);
  cache.invalidate();
  assert.equal(cache.peek("a"), undefined);
});
