import test from "node:test";
import assert from "node:assert/strict";
import {
  agentProfiles,
  connectionState,
  latestWork,
} from "../src/ui/agents/model.ts";
import type { ConnectionView } from "../src/connections/hosted.ts";
import type { DiaryEntry, StatusEntry } from "../src/journal/contracts.ts";
import type { StoredReport } from "../src/storage/port.ts";

const now = Date.parse("2026-10-27T10:00:00Z");
const connection = (
  id: string,
  displayName = "Codex agent",
): ConnectionView => ({
  id,
  displayName,
  requestedScopes: ["reports:append"],
  grantedScopes: ["reports:append"],
  status: "active",
  expiresAt: "2026-10-27T11:00:00Z",
});
const report = (
  connectionId: string,
  eventId: string,
  occurredAt: string,
): StoredReport => ({
  connectionId,
  report: {
    schemaVersion: "1",
    eventId,
    checkpointId: eventId,
    eventType: "output_reported",
    occurredAt,
    reportingMode: "explicit_checkpoint",
    isTest: true,
    summary: eventId,
    source: {
      conversationRef: null,
      segmentRef: null,
      availability: "not_exposed",
    },
    entityRefs: [],
    captures: [],
  },
  receipt: {
    eventId,
    receiptId: eventId,
    payloadDigest: "digest",
    workspaceId: "workspace",
    committedAt: occurredAt,
    records: [],
    status: "saved",
    remotePersistence: "not_verified",
  },
});
const journal = (connectionId: string, localDate: string): DiaryEntry => ({
  connectionId,
  localDate,
  timezone: "UTC",
  revision: 1,
  receivedAt: `${localDate}T20:00:00.000Z`,
  report: {
    schemaVersion: "2",
    kind: "diary",
    eventId: localDate,
    observedAt: `${localDate}T19:00:00.000Z`,
    sentAt: `${localDate}T20:00:00.000Z`,
    isTest: true,
    summary: `Journal ${localDate}`,
    evidence: [],
    localDate,
    timezone: "UTC",
    expectedRevision: 0,
    results: [],
    blockers: [],
    nextSteps: [],
  },
});
const status = (connectionId: string, observedAt: string): StatusEntry => ({
  connectionId,
  receivedAt: observedAt,
  report: {
    schemaVersion: "2",
    kind: "status",
    eventId: observedAt,
    observedAt,
    sentAt: observedAt,
    isTest: true,
    summary: `Status ${connectionId}`,
    evidence: [],
    state: "working",
  },
});

test("agent profiles isolate work by connection even when names and event IDs match", () => {
  const reports = [
    report("a", "same-event", "2026-10-26T12:00:00Z"),
    report("b", "same-event", "2026-10-26T12:00:00Z"),
  ];
  const profiles = agentProfiles(
    [connection("a"), connection("b")],
    reports,
    [journal("a", "2026-10-26"), journal("b", "2026-10-25")],
    [status("b", "2026-10-27T09:00:00Z")],
  );
  assert.equal(profiles.length, 2);
  assert.deepEqual(
    profiles
      .find((item) => item.id === "a")
      ?.reports.map((item) => item.connectionId),
    ["a"],
  );
  assert.deepEqual(
    profiles
      .find((item) => item.id === "b")
      ?.journals.map((item) => item.localDate),
    ["2026-10-25"],
  );
  assert.equal(profiles.find((item) => item.id === "a")?.status, undefined);
  assert.equal(
    profiles.find((item) => item.id === "b")?.status?.connectionId,
    "b",
  );
});

test("expired access is never presented as connected and revocation stays explicit", () => {
  assert.equal(connectionState(connection("a"), now), "Connected");
  assert.equal(
    connectionState(
      { ...connection("a"), expiresAt: "2026-10-27T10:00:00Z" },
      now,
    ),
    "Expired",
  );
  assert.equal(
    connectionState(
      {
        ...connection("a"),
        status: "revoked",
        expiresAt: "2026-10-26T10:00:00Z",
      },
      now,
    ),
    "Revoked",
  );
  assert.equal(
    connectionState({ ...connection("a"), status: "pending" }, now),
    "Pending approval",
  );
  assert.equal(
    connectionState({ ...connection("a"), status: "approved" }, now),
    "Awaiting agent",
  );
  assert.equal(connectionState(undefined, now), "History only");
});

test("historical agents survive missing connection metadata and delayed reports use observation order", () => {
  const reports = [
    report("old", "older", "2026-10-24T12:00:00Z"),
    report("old", "newer", "2026-10-25T12:00:00Z"),
  ];
  const profiles = agentProfiles(
    [],
    reports,
    [journal("old", "2026-10-26"), journal("old", "2026-10-25")],
    [status("old", "2026-10-23T12:00:00Z")],
    { old: "Codex agent" },
  );
  const profile = profiles[0];
  assert.equal(profile.name, "Codex agent");
  assert.equal(profile.connection, undefined);
  assert.deepEqual(
    profile.reports.map((item) => item.report.eventId),
    ["newer", "older"],
  );
  assert.deepEqual(
    profile.journals.map((item) => item.localDate),
    ["2026-10-26", "2026-10-25"],
  );
  assert.equal(latestWork(profile)?.summary, "Journal 2026-10-26");
  assert.equal(reports[0].report.eventId, "older");
});
