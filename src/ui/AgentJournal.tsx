"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { reportingPreferences, statusLabel } from "../journal/contracts";
import type { JournalSnapshot } from "../journal/contracts";
import { useReportClock } from "./report-clock";
import { Modal, stamp } from "./primitives";
const empty: JournalSnapshot = { diaries: [], statuses: [] };
function subscribePreferences(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
function storedPreferences() {
  return localStorage.getItem("workspace-reporting-draft-v1") ?? "";
}
function browserZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
function noSubscription() {
  return () => {};
}
async function readJournal() {
  const cap = await fetch("/api/agent/v1/capabilities", { cache: "no-store" });
  if (!cap.ok) throw new Error("Reporting availability could not be checked.");
  const active = (await cap.json()).journalEnabled === true;
  if (!active)
    return { active, journal: empty, names: {} as Record<string, string> };
  const [data, connections] = await Promise.all([
    fetch("/api/agent/v2/journal", { cache: "no-store" }),
    fetch("/api/agent/v1/control", { cache: "no-store" }),
  ]);
  if (!data.ok || !connections.ok)
    throw new Error(
      "Unable to refresh the diary. Previously displayed entries may be stale.",
    );
  return {
    active,
    journal: (await data.json()) as JournalSnapshot,
    names: Object.fromEntries(
      (await connections.json()).connections.map(
        (c: { id: string; displayName: string }) => [c.id, c.displayName],
      ),
    ) as Record<string, string>,
  };
}
export default function AgentJournal() {
  const now = useReportClock();
  const [journal, setJournal] = useState(empty),
    [names, setNames] = useState<Record<string, string>>({}),
    [active, setActive] = useState<boolean | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [sync, setSync] = useState(false),
    [notice, setNotice] = useState("");
  const stored = useSyncExternalStore(
    subscribePreferences,
    storedPreferences,
    () => "",
  );
  const localZone = useSyncExternalStore(noSubscription, browserZone, () => "");
  let preferences = {
    timezone: localZone,
    endOfDay: "18:00",
    activeCadenceHours: 3,
  };
  try {
    if (stored) {
      const v = JSON.parse(stored);
      preferences = reportingPreferences(
        v.timezone,
        v.endOfDay,
        v.activeCadenceHours,
      );
    }
  } catch {
    /* Invalid drafts never configure a host. */
  }
  const [draft, setDraft] = useState<{
      zone: string;
      endOfDay: string;
      cadence: number;
    } | null>(null),
    [agent, setAgent] = useState("all");
  const fields = draft ?? {
    zone: preferences.timezone,
    endOfDay: preferences.endOfDay,
    cadence: preferences.activeCadenceHours,
  };
  const { zone, endOfDay, cadence } = fields;
  async function load() {
    setBusy(true);
    setError("");
    try {
      const data = await readJournal();
      setActive(data.active);
      setJournal(data.journal);
      setNames(data.names);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to read diary.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let stopped = false;
    readJournal()
      .then((data) => {
        if (!stopped) {
          setActive(data.active);
          setJournal(data.journal);
          setNames(data.names);
        }
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, []);
  const syncText = `Use the Workspace integration skill for this approved project. Send a current status report, then create or revise the single diary entry for the relevant local date in ${zone || "the configured IANA timezone"}. Keep original observation times for backfills. Recover receipts before retrying unknown outcomes. Share only approved work summaries, results, blockers, next steps and intentional evidence links; no credentials or internal reasoning. This request does not grant new access.`;
  const title = (id: string) => names[id] ?? `Agent ${id.slice(0, 8)}`;
  return (
    <section className="panel secondary-panel">
      <div className="panel-heading">
        <h2>Agent reporting</h2>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void load();
          }}
        >
          Refresh status
        </button>
      </div>
      <p>
        Status updates and reporting preferences.{" "}
        <a href="#journal">Read daily entries in Journal</a>.
      </p>
      {active === null && !error ? (
        <p>Loading diary...</p>
      ) : active === false ? (
        <p>Agent reporting is disabled.</p>
      ) : null}
      <div className="panel-heading">
        <a
          href="/skills/workspace-reporting/SKILL.md"
          target="_blank"
          rel="noreferrer"
        >
          Integration guide
        </a>
        <button className="secondary" onClick={() => setSync(true)}>
          Request an update
        </button>
      </div>
      <details>
        <summary>Reporting preferences</summary>
        <form
          className="preferences-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              const p = reportingPreferences(zone, endOfDay, cadence);
              localStorage.setItem(
                "workspace-reporting-draft-v1",
                JSON.stringify(p),
              );
              setNotice(
                "Draft saved in this browser. Apply it in your agent host to enable scheduling.",
              );
            } catch {
              setNotice(
                "Use a valid IANA timezone, local time and cadence between 1 and 24 hours.",
              );
            }
          }}
        >
          <label>
            Timezone
            <input
              value={zone}
              onChange={(e) => setDraft({ ...fields, zone: e.target.value })}
              placeholder="Asia/Kolkata"
              required
            />
          </label>
          <label>
            Daily summary time
            <input
              type="time"
              value={endOfDay}
              onChange={(e) =>
                setDraft({ ...fields, endOfDay: e.target.value })
              }
              required
            />
          </label>
          <label>
            Status interval (hours)
            <input
              type="number"
              min="1"
              max="24"
              value={cadence}
              onChange={(e) =>
                setDraft({ ...fields, cadence: Number(e.target.value) })
              }
            />
          </label>
          <button className="secondary">Save preferences</button>
          <p>
            These preferences stay in this browser. Apply them in your agent
            host to schedule reports.
          </p>
          <p role="status">{notice}</p>
        </form>
      </details>
      {active ? (
        <>
          <label htmlFor="journal-agent">Agent</label>
          <select
            id="journal-agent"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="all">All agents</option>
            {Object.entries(names).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <h3>Latest status</h3>
          {journal.statuses
            .filter((s) => agent === "all" || s.connectionId === agent)
            .map((s) => (
              <article className="registration" key={s.connectionId}>
                <strong>{title(s.connectionId)}</strong>
                <p>{statusLabel(s, now, cadence)}</p>
                <p>{s.report.summary}</p>
                <details>
                  <summary>Report times</summary>
                  <p>
                    Observed {stamp(s.report.observedAt)} / Sent{" "}
                    {stamp(s.report.sentAt)} / Received {stamp(s.receivedAt)}
                  </p>
                </details>
              </article>
            ))}
          {!journal.statuses.some(
            (s) => agent === "all" || s.connectionId === agent,
          ) ? (
            <p>No status received for this selection.</p>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {sync ? (
        <Modal title="Request an agent update" onClose={() => setSync(false)}>
          <p>Send this request to your connected agent through its host.</p>
          <label>
            Sync request
            <textarea rows={7} readOnly value={syncText} />
          </label>
          <p>
            Keep credentials in your agent host. Do not include them in this
            request.
          </p>
          <footer className="form-actions">
            <button className="secondary" onClick={() => setSync(false)}>
              Close
            </button>
          </footer>
        </Modal>
      ) : null}
    </section>
  );
}
