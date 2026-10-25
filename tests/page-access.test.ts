import test from "node:test";
import assert from "node:assert/strict";
import {
  pageDestination,
  resolvePageAccess,
} from "../src/server/page-access.ts";
const hosted = {
  mode: "supabase" as const,
  origin: "http://127.0.0.1:3212",
  url: "https://example.supabase.co",
  publishableKey: "sb_publishable_test",
};

test("anonymous visitors get the landing page but cannot open dashboard routes", () => {
  assert.equal(pageDestination("/", false, "supabase"), null);
  assert.equal(pageDestination("/login", false, "supabase"), null);
  assert.equal(pageDestination("/app", false, "supabase"), "/login");
  assert.equal(pageDestination("/app/anything", false, "supabase"), "/login");
});
test("verified sessions go to the dashboard from the landing and login pages", async () => {
  for (const path of ["/", "/login?next=https://evil.test"]) {
    const result = await resolvePageAccess(
      new Request(hosted.origin + path),
      hosted,
      async () => {},
    );
    assert.equal(result.destination, "/app");
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal(pageDestination("/app", true, "supabase"), null);
});
test("forged or unavailable sessions fail closed and preserve refresh-cookie headers", async () => {
  const request = new Request(hosted.origin + "/app?next=https://evil.test", {
    headers: { cookie: "forged=session" },
  });
  const denied = await resolvePageAccess(request, hosted, async () => {
    throw new Error("invalid");
  });
  assert.equal(denied.destination, "/login");
  const renewed = await resolvePageAccess(
    request,
    hosted,
    async (_request, _config, headers) => {
      headers.append("Set-Cookie", "test-a=one; HttpOnly; Path=/");
      headers.append("Set-Cookie", "test-b=two; HttpOnly; Path=/");
    },
  );
  assert.equal(renewed.destination, null);
  assert.equal(renewed.headers.getSetCookie().length, 2);
});
test("loopback SQLite keeps an explicit local development entry point", async () => {
  const result = await resolvePageAccess(
    new Request("http://127.0.0.1:3218/app"),
    { mode: "sqlite", origin: "http://127.0.0.1:3218" },
    async () => {
      assert.fail("local development must not use hosted auth");
    },
  );
  assert.equal(result.destination, null);
  assert.equal(pageDestination("/", false, "sqlite"), null);
});
