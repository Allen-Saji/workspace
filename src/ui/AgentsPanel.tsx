"use client";
import { useEffect, useState } from "react";
import type { ConnectionView } from "../connections/hosted";
import type { JournalSnapshot, DiaryEntry } from "../journal/contracts";
import type { AgentJournalView } from "../journal/personal";
import type { StoredReport } from "../storage/port";
import Connections from "./Connections";
import { agentProfiles, connectionState, latestWork } from "./agents/model";
import { Icon, Modal, stamp } from "./primitives";
import { useReportClock } from "./report-clock";
import styles from "./AgentsPanel.module.css";

type Directory = {
  connections: ConnectionView[];
  journal: JournalSnapshot;
  names: Record<string, string>;
  enabled: boolean;
};
async function readJson(response: Response) {
  if (!response.ok) throw new Error("Agent information could not be loaded.");
  return response.json();
}
async function readDirectory(signal: AbortSignal) {
  signal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const capabilities = await fetch("/api/agent/v1/capabilities", {
    signal,
  }).then(readJson);
  const [connections, saved, journal] = await Promise.allSettled([
    capabilities.enabled
      ? fetch("/api/agent/v1/control", { signal }).then(readJson)
      : Promise.resolve({ connections: [] }),
    fetch("/api/journal?view=agents", { signal }).then(readJson),
    capabilities.journalEnabled
      ? fetch("/api/agent/v2/journal", { signal }).then(readJson)
      : Promise.resolve({ diaries: [], statuses: [] }),
  ]);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const warnings: string[] = [];
  if (connections.status === "rejected")
    warnings.push("Connection details are unavailable.");
  if (
    saved.status === "rejected" &&
    (journal.status === "rejected" || !capabilities.journalEnabled)
  )
    warnings.push("Agent journals are unavailable.");
  if (journal.status === "rejected" && capabilities.journalEnabled)
    warnings.push("Latest status updates are unavailable.");
  const history: AgentJournalView | null =
    saved.status === "fulfilled" ? saved.value : null;
  const current: JournalSnapshot | null =
    journal.status === "fulfilled" ? journal.value : null;
  return {
    data: {
      connections:
        connections.status === "fulfilled" ? connections.value.connections : [],
      journal: {
        diaries: current?.diaries.length
          ? current.diaries
          : (history?.diaries ?? []),
        statuses: current?.statuses ?? [],
      },
      names: history?.names ?? {},
      enabled: capabilities.enabled === true,
    } as Directory,
    warning: warnings.join(" "),
    connectionsUnavailable: connections.status === "rejected",
    journalsUnavailable:
      saved.status === "rejected" &&
      (journal.status === "rejected" || !capabilities.journalEnabled),
    statusesUnavailable: journal.status === "rejected",
  };
}

function DailyEntry({ entry }: { entry: DiaryEntry }) {
  return (
    <article className={styles.entry}>
      <header className={styles.entryHeading}>
        <h3>{entry.localDate}</h3>
        <span>
          {entry.timezone}
          {entry.report.isTest ? " / Sample" : ""}
        </span>
      </header>
      <p className={styles.summary}>{entry.report.summary}</p>
      {(["results", "blockers", "nextSteps"] as const)
        .filter((field) => entry.report[field].length)
        .map((field) => (
          <div key={field}>
            <h4>
              {field === "results"
                ? "What got done"
                : field === "blockers"
                  ? "Blockers"
                  : "Next steps"}
            </h4>
            <ul>
              {entry.report[field].map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          </div>
        ))}
      {!!entry.report.evidence.length && (
        <ul>
          {entry.report.evidence.map((evidence, index) => (
            <li key={index}>
              <a href={evidence.url} target="_blank" rel="noopener noreferrer">
                {evidence.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <small>
        Revision {entry.revision} / Received {stamp(entry.receivedAt)}
      </small>
    </article>
  );
}

export default function AgentsPanel({
  reports,
  refreshKey,
  onOpenReport,
  onImportReport,
  onRefresh,
}: {
  reports: StoredReport[];
  refreshKey: number;
  onOpenReport: (report: StoredReport) => void;
  onImportReport: () => void;
  onRefresh: () => Promise<void>;
}) {
  const now = useReportClock();
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "reports" | "journals">(
    "overview",
  );
  const [filter, setFilter] = useState("all");
  const [manage, setManage] = useState(false);
  const [request, setRequest] = useState(false);
  const [journalDate, setJournalDate] = useState("");
  const loadKey = `${refreshKey}:${reload}`;
  const loading = loadedKey !== loadKey;
  useEffect(() => {
    const controller = new AbortController();
    readDirectory(controller.signal)
      .then(
        ({
          data,
          warning,
          connectionsUnavailable,
          journalsUnavailable,
          statusesUnavailable,
        }) => {
          if (controller.signal.aborted) return;
          setDirectory((previous) => ({
            ...data,
            connections: connectionsUnavailable
              ? (previous?.connections ?? [])
              : data.connections,
            journal: {
              diaries: journalsUnavailable
                ? (previous?.journal.diaries ?? [])
                : data.journal.diaries,
              statuses: statusesUnavailable
                ? (previous?.journal.statuses ?? [])
                : data.journal.statuses,
            },
            names: { ...previous?.names, ...data.names },
          }));
          setError(warning);
        },
      )
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Agents could not be refreshed. Previously loaded information may be out of date.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedKey(loadKey);
      });
    return () => controller.abort();
  }, [loadKey]);
  const agents = agentProfiles(
    directory?.connections ?? [],
    reports,
    directory?.journal.diaries ?? [],
    directory?.journal.statuses ?? [],
    directory?.names,
  );
  const agent = agents.find((item) => item.id === selected);
  const connected = agents.filter(
    (item) => connectionState(item.connection, now) === "Connected",
  );
  const visible = agents.filter((item) => {
    const state = connectionState(item.connection, now);
    return (
      filter === "all" ||
      (filter === "connected"
        ? state === "Connected"
        : filter === "requests"
          ? ["Pending approval", "Awaiting agent"].includes(state)
          : !["Connected", "Pending approval", "Awaiting agent"].includes(
              state,
            ))
    );
  });
  function select(id: string) {
    setSelected(id);
    setTab("overview");
    setJournalDate("");
  }
  const work = agent ? latestWork(agent) : null;
  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {agent ? (
          <button
            className="text-button"
            onClick={() => {
              setSelected(null);
              setRequest(false);
            }}
          >
            Back to agents
          </button>
        ) : (
          <p>
            {loading && !directory
              ? "Loading agents..."
              : `${connected.length} connected / ${agents.length} total`}
          </p>
        )}
        <div className={styles.actions}>
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void onRefresh()}
          >
            Refresh agents
          </button>
          <button className="secondary" onClick={() => setManage(true)}>
            Manage connections
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {directory?.enabled === false && (
        <p className={styles.notice}>
          New agent connections are disabled. Saved work remains available.
        </p>
      )}
      {agent ? (
        <section
          className={`panel ${styles.profile}`}
          aria-label={`${agent.name} profile`}
        >
          <header className={styles.profileHeading}>
            <span className={styles.avatar}>
              <Icon name="agents" />
            </span>
            <div className={styles.identity}>
              <h2>{agent.name}</h2>
              <p>{connectionState(agent.connection, now)}</p>
            </div>
            <button className="secondary" onClick={() => setRequest(true)}>
              Request an update
            </button>
          </header>
          <div className={styles.tabs} role="group" aria-label="Agent work">
            {(["overview", "reports", "journals"] as const).map((value) => (
              <button
                key={value}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {value === "overview"
                  ? "Overview"
                  : value === "reports"
                    ? `Reports (${agent.reports.length})`
                    : `Journal (${agent.journals.length})`}
              </button>
            ))}
          </div>
          {tab === "overview" && (
            <div className={styles.content}>
              <div className={styles.metrics}>
                <div>
                  <strong>{agent.reports.length}</strong>
                  <span>reports</span>
                </div>
                <div>
                  <strong>{agent.journals.length}</strong>
                  <span>journal days</span>
                </div>
                <div>
                  <strong>{work ? stamp(work.at) : "No updates"}</strong>
                  <span>last reported</span>
                </div>
              </div>
              <section className={styles.latest}>
                <h3>Latest work</h3>
                {work ? (
                  <>
                    <p className={styles.summary}>{work.summary}</p>
                    <small>Reported {stamp(work.at)}</small>
                  </>
                ) : (
                  <p>No work has been reported yet.</p>
                )}
                {agent.status && (
                  <p className={styles.notice}>
                    {now &&
                    now - Date.parse(agent.status.report.observedAt) >
                      4 * 3600000
                      ? "Status is out of date"
                      : `Agent-reported: ${agent.status.report.state}`}
                  </p>
                )}
              </section>
              <details className={styles.access}>
                <summary>Connection details</summary>
                <dl>
                  <dt>Registered name</dt>
                  <dd>{agent.name}</dd>
                  <dt>Connection</dt>
                  <dd>{agent.id}</dd>
                  {agent.connection && (
                    <>
                      <dt>Access expires</dt>
                      <dd>{stamp(agent.connection.expiresAt)}</dd>
                    </>
                  )}
                </dl>
                <p>Names and work updates are supplied by the agent.</p>
              </details>
            </div>
          )}
          {tab === "reports" && (
            <div className={styles.content}>
              <h3>Reports from {agent.name}</h3>
              {agent.reports.length ? (
                agent.reports.map((item) => (
                  <button
                    className={styles.report}
                    key={item.report.eventId}
                    onClick={() => onOpenReport(item)}
                  >
                    <span>
                      <strong>{item.report.summary}</strong>
                      <small>
                        {stamp(item.report.occurredAt)}
                        {item.report.isTest ? " / Sample" : ""}
                      </small>
                    </span>
                    <span aria-hidden="true">&gt;</span>
                  </button>
                ))
              ) : (
                <p className={styles.empty}>
                  This agent has not sent any reports yet.
                </p>
              )}
            </div>
          )}
          {tab === "journals" && (
            <div className={styles.content}>
              <div className={styles.journalHeading}>
                <h3>Daily journal</h3>
                <label>
                  Date
                  <input
                    type="date"
                    value={journalDate}
                    onChange={(event) => setJournalDate(event.target.value)}
                  />
                </label>
                {journalDate && (
                  <button
                    className="text-button"
                    onClick={() => setJournalDate("")}
                  >
                    All dates
                  </button>
                )}
              </div>
              {agent.journals
                .filter(
                  (item) => !journalDate || item.localDate === journalDate,
                )
                .map((item) => (
                  <DailyEntry key={item.localDate} entry={item} />
                ))}
              {!agent.journals.some(
                (item) => !journalDate || item.localDate === journalDate,
              ) && (
                <p className={styles.empty}>
                  {journalDate
                    ? "No journal entry for this date."
                    : "This agent has not published a journal yet."}
                </p>
              )}
            </div>
          )}
        </section>
      ) : (
        <>
          <div
            className={styles.filters}
            role="group"
            aria-label="Filter agents"
          >
            {[
              ["all", "All agents"],
              ["connected", "Connected"],
              ["requests", "Requests"],
              ["history", "History"],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.grid}>
            {visible.map((item) => {
              const latest = latestWork(item);
              const state = connectionState(item.connection, now);
              return (
                <button
                  className={styles.card}
                  key={item.id}
                  aria-label={`View ${item.name}`}
                  onClick={() => select(item.id)}
                >
                  <span className={styles.cardHeading}>
                    <span className={styles.avatar}>
                      <Icon name="agents" />
                    </span>
                    <span
                      className={styles.badge}
                      data-connected={state === "Connected"}
                    >
                      {state}
                    </span>
                  </span>
                  <strong className={styles.name}>{item.name}</strong>
                  <span className={styles.cardSummary}>
                    {latest?.summary ?? "No work reported yet."}
                  </span>
                  <span className={styles.cardCounts}>
                    {item.reports.length}{" "}
                    {item.reports.length === 1 ? "report" : "reports"} /{" "}
                    {item.journals.length}{" "}
                    {item.journals.length === 1
                      ? "journal day"
                      : "journal days"}
                  </span>
                  <span className={styles.cardFooter}>
                    <span>
                      {latest ? stamp(latest.at) : "Awaiting first update"}
                    </span>
                    <span aria-hidden="true">&gt;</span>
                  </span>
                </button>
              );
            })}
          </div>
          {!loading && !visible.length && (
            <div className={`panel ${styles.empty}`}>
              <Icon name="agents" />
              <h2>
                {agents.length
                  ? "No agents in this view"
                  : "No agents connected yet"}
              </h2>
              <p>
                {agents.length
                  ? "Choose another filter to see your agents."
                  : "Connect an agent to see its work, reports, and daily journal here."}
              </p>
              <button className="secondary" onClick={() => setManage(true)}>
                Manage connections
              </button>
            </div>
          )}
        </>
      )}
      {manage && (
        <Modal
          title="Manage agent connections"
          onClose={() => {
            setManage(false);
          }}
        >
          <Connections
            onChanged={() => {
              setReload((value) => value + 1);
            }}
          />
          <details className={styles.access}>
            <summary>Manual report import</summary>
            <p>
              Import a structured report from an agent without a direct
              connection.
            </p>
            <button
              className="secondary"
              onClick={() => {
                setManage(false);
                onImportReport();
              }}
            >
              Import report
            </button>
          </details>
        </Modal>
      )}
      {request && agent && (
        <Modal
          title={`Request an update from ${agent.name}`}
          onClose={() => setRequest(false)}
        >
          <p>Send this request to {agent.name} in its chat or terminal.</p>
          <label>
            Request
            <textarea
              rows={6}
              readOnly
              value={`Use the Workspace reporting skill at ${window.location.origin}/skills/workspace-reporting/SKILL.md with your approved connection for ${agent.name}. Publish a current status and your daily journal with completed work, results, blockers, next steps, and evidence links. Check capabilities and connection access first. Recover receipts before retrying uncertain submissions.`}
            />
          </label>
          <p>
            <a
              href="/skills/workspace-reporting/SKILL.md"
              target="_blank"
              rel="noreferrer"
            >
              Open reporting skill
            </a>
          </p>
        </Modal>
      )}
    </div>
  );
}
