import test from "node:test";
import assert from "node:assert/strict";
import { brandMetadata } from "../src/server/metadata.ts";
test("metadata does not invent a deployment origin or globally block public indexing", () => {
  const m = brandMetadata({});
  assert.equal(m.metadataBase, undefined);
  assert.equal(m.alternates, undefined);
  assert.equal(m.robots, undefined);
  assert.ok(
    m.twitter &&
      "card" in m.twitter &&
      m.twitter.card === "summary_large_image",
  );
  assert.equal(
    String(
      brandMetadata({ WORKSPACE_ORIGIN: "http://127.0.0.1:3218" }).metadataBase,
    ),
    "http://127.0.0.1:3218/",
  );
  assert.equal(
    String(
      brandMetadata({ WORKSPACE_PUBLIC_ORIGIN: "https://example.test" })
        .metadataBase,
    ),
    "https://example.test/",
  );
  assert.throws(() =>
    brandMetadata({ WORKSPACE_PUBLIC_ORIGIN: "https://example.test/path" }),
  );
});

import {
  landingMetadata,
  siteRobots,
  siteSitemap,
} from "../src/server/metadata.ts";
test("only a verified production origin enables public discovery", () => {
  assert.deepEqual(siteSitemap({}), []);
  assert.deepEqual(siteRobots({}), {
    rules: { userAgent: "*", disallow: "/" },
  });
  assert.deepEqual(landingMetadata({}).robots, { index: false, follow: false });
  const env = { WORKSPACE_PUBLIC_ORIGIN: "https://example.test" };
  assert.deepEqual(landingMetadata(env).alternates, {
    canonical: "https://example.test",
  });
  assert.deepEqual(landingMetadata(env).robots, { index: true, follow: true });
  assert.deepEqual(
    siteSitemap(env).map((entry) => entry.url),
    ["https://example.test"],
  );
  assert.deepEqual(siteRobots(env).rules, {
    userAgent: "*",
    allow: "/",
    disallow: ["/app", "/login", "/connect", "/api/", "/auth/"],
  });
});
test("new social metadata uses the robot brand without inventing a domain", () => {
  const meta = brandMetadata({});
  assert.equal(meta.manifest, "/manifest.webmanifest");
  assert.ok(JSON.stringify(meta).includes("A place for your plans."));
  assert.ok(JSON.stringify(meta.twitter).includes("/opengraph-image.png"));
  for (const origin of [
    "http://example.test",
    "https://example.test/path",
    "https://example.test?x=1",
  ])
    assert.throws(() => landingMetadata({ WORKSPACE_PUBLIC_ORIGIN: origin }));
});
