"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { Receipt, WorkspaceRecord } from "../domain/contracts";
import type { StoredReport } from "../storage/port";
import CommandReview from "./CommandReview";
import CommandHistory from "./CommandHistory";
import Connections from "./Connections";
import AgentJournal from "./AgentJournal";
import { reportedState, useReportClock } from "./report-clock";
import Editor, { type EditTarget } from "./Editor";
import ReportImport from "./ReportImport";
import Companion from "./Companion";
import AssistantPanel from "./AssistantPanel";
import CalendarPanel from "./CalendarPanel";
import Brand from "./Brand";
import RobotSprite from "./RobotSprite";
import ArcadeProgress from "./ArcadeProgress";
import { reactionForSave, type PetReaction } from "./companion-state";
import { Badge, Icon, Modal, readable as s, stamp } from "./primitives";
type View = "today" | "calendar" | "learning" | "agents" | "context";
type Snapshot = {
  workspaceId: string;
  storageMode: "sqlite" | "supabase";
  records: WorkspaceRecord[];
  reports: StoredReport[];
  lastReported: string | null;
  freshness: string;
};
const views: View[] = ["today", "calendar", "learning", "agents", "context"];
const labels = {
  today: "Today",
  calendar: "Calendar",
  learning: "Learning",
  agents: "Agents",
  context: "Context",
};
const descriptions = {
  today: "Tasks, meetings, and notes.",
  calendar: "Your meetings and available time.",
  learning: "Track what you are learning.",
  agents: "Reports and connected agents.",
  context: "Decisions and details worth keeping.",
};
function subscribeLocation(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
function currentView(): View {
  const v = location.hash.slice(1);
  return views.includes(v as View) ? (v as View) : "today";
}
function subscribeDate() {
  return () => {};
}
function currentDate() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
const errors: Record<string, string> = {
  auth_required: "Sign in to continue. Your session could not be verified.",
  workspace_not_provisioned: "Your account has no provisioned workspace yet.",
  configuration_required:
    "Hosted storage is not configured. No local fallback was used.",
  storage_unavailable:
    "Hosted storage is unavailable. Save outcome may be unknown; retain your event ID.",
  revision_conflict:
    "This record changed elsewhere. Close this draft, refresh, and review the latest version.",
  invalid_interval: "The end must be after the start.",
  invalid_date: "Choose a real calendar date.",
  idempotency_conflict:
    "This event ID already belongs to different content. The saved report was not changed.",
  capture_conflict:
    "A capture ID is already in use. No part of this report was saved.",
  unknown_entity: "A linked record does not exist in this workspace.",
  registration_closed: "This request is already closed.",
  invalid_schema: "Some required fields are missing or invalid.",
  unknown_field: "The report contains unsupported fields.",
  invalid_text: "A required text field is empty or too long.",
  invalid_timestamp: "Use a valid UTC reporting time, not a future time.",
};
async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      errors[body.error?.code] ??
        `Could not save (${body.error?.code ?? response.status}). Your draft is preserved.`,
    );
  return body;
}
async function post(path: string, payload: unknown) {
  try {
    return await responseJson(
      await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Request": "local-ui",
        },
        body: JSON.stringify(payload),
      }),
    );
  } catch (e) {
    if (e instanceof TypeError)
      throw new Error(
        "Connection lost. Save outcome is unknown. Refresh before retrying; retain the same report ID.",
      );
    throw e;
  }
}
export default function Workspace() {
  const router = useRouter();
  const now = useReportClock();
  const view = useSyncExternalStore(
    subscribeLocation,
    currentView,
    (): View => "today",
  );
  const date = useSyncExternalStore(subscribeDate, currentDate, () => "");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<EditTarget | null>(null),
    [importing, setImporting] = useState(false),
    [detail, setDetail] = useState<WorkspaceRecord | StoredReport | null>(null),
    [working, setWorking] = useState(false);
  const [query, setQuery] = useState("");
  const [assistant, setAssistant] = useState<{contextId?: string; prompt?: string} | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [petReaction, setPetReaction] = useState<PetReaction | null>(null);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const data = await responseJson(
        await fetch("/api/workspace", { cache: "no-store" }),
      );
      setSnapshot(data);
      setError("");
    } catch (e) {
      setSnapshot(null);
      setError(e instanceof Error ? e.message : "Unable to refresh.");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/workspace", { cache: "no-store", signal: controller.signal })
      .then(responseJson)
      .then((data) => setSnapshot(data))
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to load workspace.",
          );
      });
    const change = () => {
      setDetail(null);
      setEditing(null);
      setImporting(false);
      setCommandOpen(false);
      setHistoryOpen(false);
    };
    window.addEventListener("hashchange", change);
    return () => {
      controller.abort();
      window.removeEventListener("hashchange", change);
    };
  }, []);
  async function signout() {
    if (working) return;
    setWorking(true);
    try {
      await post("/api/auth", { action: "signout" });
      setSnapshot(null);
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign out.");
    } finally {
      setWorking(false);
    }
  }
  async function save(command: unknown) {
    setPendingSaves((count) => count + 1);
    try {
      await post("/api/workspace", command);
      const id = (command as { id?: string } | null)?.id;
      const kind = reactionForSave(
        command,
        snapshot?.records.find((record) => record.id === id),
      );
      setPetReaction((previous) => ({ id: (previous?.id ?? 0) + 1, kind }));
      setNotice(
        snapshot?.storageMode === "supabase"
          ? "Saved in your hosted workspace."
          : "Saved on this computer.",
      );
      await refresh();
    } finally {
      setPendingSaves((count) => count - 1);
    }
  }
  async function importReport(payload: unknown) {
    const receipt: Receipt = await post("/api/reports", payload);
    await refresh();
    return receipt;
  }
  const records = snapshot?.records ?? [],
    reports = snapshot?.reports ?? [];
  const tasks = records.filter((r) => r.kind === "task"),
    lessons = records.filter((r) => r.kind === "lesson"),
    meetings = records
      .filter((r) => r.kind === "meeting")
      .sort((a, b) => s(a.data.start).localeCompare(s(b.data.start)));
  const captures = records.filter((r) => r.kind === "capture"),
    notes = records.filter((r) => r.kind === "note");
  const completed = lessons.filter((r) => r.data.status === "completed").length;
  const latest = reports.find(
      (r) =>
        !r.report.isTest &&
        r.connectionId === "current-assistant-explicit-relay",
    ),
    todayKey = new Date().toLocaleDateString("en-CA");
  const dayMeetings = meetings.filter(
    (r) => new Date(s(r.data.start)).toLocaleDateString("en-CA") === todayKey,
  );
  const visibleTasks = tasks;
  const remainingTasks = tasks.filter(
    (task) => task.data.status !== "done",
  ).length;
  async function toggleTask(record: WorkspaceRecord) {
    if (working) return;
    setWorking(true);
    try {
      await save({
        id: record.id,
        kind: "task",
        expectedRevision: record.revision,
        data: {
          title: record.data.title,
          dueDate: record.data.dueDate,
          status: record.data.status === "done" ? "ready" : "done",
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="shell">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand href="#today" />
        <nav aria-label="Workspace navigation">
          {views.map((v) => (
            <a
              key={v}
              href={`#${v}`}
              aria-current={view === v ? "page" : undefined}
              className={view === v ? "selected" : ""}
            >
              <Icon name={v} />
              <span>{labels[v]}</span>
            </a>
          ))}
        </nav>
      </aside>
      <main id="main" className="workspace-main">
        <div className="topbar">
          <span>{date || "Your workspace"}</span>
          <div>
            {snapshot ? (
              <Companion
                key={snapshot.workspaceId}
                workspaceId={snapshot.workspaceId}
                busy={pendingSaves > 0 || assistantBusy}
                onAsk={() => setAssistant({})}
                reaction={petReaction}
              />
            ) : null}
            {snapshot ? <button className="text-button" onClick={() => setAssistant({})}>Ask assistant</button> : null}
            <button className="text-button" onClick={() => void refresh()}>
              Refresh
            </button>
            {snapshot?.storageMode === "supabase" ? (
              <button
                className="text-button"
                disabled={working}
                onClick={() => void signout()}
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
        <header className="page-header">
          <div>
            <h1>{labels[view]}</h1>
            <p className="subtitle">{descriptions[view]}</p>
          </div>
          {snapshot && view === "today" ? (
            <button
              className="primary"
              onClick={() => setEditing({ kind: "task" })}
            >
              Add task
            </button>
          ) : null}
        </header>
        {error ? (
          <div role="alert" className="error page-alert">
            {error}{" "}
            {error.startsWith("Sign in") ? <a href="/login">Sign in</a> : null}
            <button className="text-button" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        ) : null}
        <div role="status">
          {notice ? <p className="save-notice">{notice}</p> : null}
        </div>
        {view === "calendar" && snapshot ? <CalendarPanel key={snapshot.workspaceId} workspaceId={snapshot.workspaceId} onChanged={refresh} onAsk={(prompt) => setAssistant({prompt})} /> : null}
        {view === "today" && snapshot && !records.length && !reports.length ? (
          <section className="welcome-panel">
            <div>
              <h2>Start with one task.</h2>
              <p>
                Add something you want to do today. Make this space yours as you
                go.
              </p>
            </div>
            <button
              className="primary"
              onClick={() => setEditing({ kind: "task" })}
            >
              Add your first task
            </button>
          </section>
        ) : null}
        {view === "today" && snapshot ? (
          <section className="command-strip">
            <div className="command-copy">
              <span className="arcade-icon">
                <Icon name="context" />
              </span>
              <div>
                <h2>What would you like to do?</h2>
                <p>Ask your assistant, or enter a structured draft.</p>
              </div>
            </div>
            <div className="action-group">
              <button className="primary" onClick={() => setAssistant({})}>Ask assistant</button>
              <button
                className="text-button"
                onClick={() => setHistoryOpen(true)}
              >
                History
              </button>
              <button
                className="secondary"
                onClick={() => setCommandOpen(true)}
              >
                Write a draft
              </button>
            </div>
          </section>
        ) : null}
        {!snapshot ? (
          <div className="panel loading">
            {error ? "Workspace unavailable." : "Loading workspace..."}
          </div>
        ) : (
          <>
            <div className={`dashboard ${view !== "today" ? "focused" : ""}`}>
              {view === "today" ? (
                <section className="panel day-panel">
                  <div className="panel-heading">
                    <h2>
                      <Icon name="today" />
                      Today&apos;s schedule
                    </h2>
                    <span className="muted small">
                      {remainingTasks} {remainingTasks === 1 ? "task" : "tasks"}{" "}
                      left
                      <ArcadeProgress
                        value={tasks.length - remainingTasks}
                        max={tasks.length}
                        label="Completed tasks"
                      />
                    </span>
                  </div>
                  <div className="day-content">
                    {dayMeetings.length ? (
                      <div className="meetings">
                        {dayMeetings.map((m) => (
                          <button
                            className="meeting-row"
                            key={m.id}
                            onClick={() =>
                              setEditing({ kind: "meeting", record: m })
                            }
                          >
                            <time>
                              {new Date(s(m.data.start)).toLocaleTimeString(
                                undefined,
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </time>
                            <span>
                              <strong>{s(m.data.title)}</strong>
                              <small>
                                {Math.round(
                                  (Date.parse(s(m.data.end)) -
                                    Date.parse(s(m.data.start))) /
                                    60000,
                                )}{" "}
                                min
                              </small>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-state compact">No meetings today.</p>
                    )}
                    <div className="task-list">
                      {visibleTasks.map((t) => (
                        <div className="task-row" key={t.id}>
                          <button
                            className={`check ${t.data.status === "done" ? "checked" : ""}`}
                            aria-label={`${t.data.status === "done" ? "Reopen" : "Complete"} ${s(t.data.title)}`}
                            aria-pressed={t.data.status === "done"}
                            onClick={() => void toggleTask(t)}
                            disabled={working}
                          >
                            <span aria-hidden="true">
                              {t.data.status === "done" ? (
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                >
                                  <path
                                    d="m3 8 3 3 7-7"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                  />
                                </svg>
                              ) : null}
                            </span>
                          </button>
                          <button
                            className={`task-title ${t.data.status === "done" ? "done" : ""}`}
                            onClick={() =>
                              setEditing({ kind: "task", record: t })
                            }
                          >
                            {s(t.data.title)}
                            {t.data.dueDate ? (
                              <small>{s(t.data.dueDate)}</small>
                            ) : null}
                          </button>
                          <button className="text-button task-assistant" aria-label={`Ask about ${s(t.data.title)}`} onClick={() => setAssistant({contextId:t.id})}>
                            <Icon name="agents" />
                          </button>
                        </div>
                      ))}
                    </div>
                    {!tasks.length ? (
                      <p className="empty-state compact">
                        No tasks yet. Add one to get started.
                      </p>
                    ) : null}
                  </div>
                  <footer className="panel-footer">
                    <button
                      className="text-button"
                      onClick={() => setEditing({ kind: "task" })}
                    >
                      Add task
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setEditing({ kind: "meeting" })}
                    >
                      Add meeting
                    </button>
                  </footer>
                </section>
              ) : null}
              {view === "today" || view === "agents" ? (
                <section className="panel agent-panel">
                  <div className="panel-heading">
                    <h2>
                      <Icon name="agents" />
                      Assistant updates
                    </h2>
                  </div>
                  <div className="panel-body assistant-copy">
                    <div className="assistant-robot">
                      <RobotSprite pose={latest ? "saved" : "idle"} />
                    </div>
                    <p>
                      {latest
                        ? latest.report.summary
                        : "No updates shared yet."}
                    </p>
                    {latest ? (
                      <p className="muted small">
                        {stamp(latest.report.occurredAt)}
                        <br />
                        {reportedState(latest.report.occurredAt, now)}
                      </p>
                    ) : (
                      <p className="muted small">
                        Updates appear when the assistant sends a report.
                      </p>
                    )}
                  </div>
                  <footer className="panel-footer">
                    {latest ? (
                      <button
                        className="text-button"
                        onClick={() => setDetail(latest)}
                      >
                        View report
                      </button>
                    ) : (
                      <span />
                    )}
                    <button
                      className="text-button"
                      onClick={() => setImporting(true)}
                    >
                      Import report
                    </button>
                  </footer>
                </section>
              ) : null}
              {view === "today" || view === "learning" ? (
                <section className="panel learning-panel">
                  <div className="panel-heading">
                    <h2>
                      <Icon name="learning" />
                      Learning steps
                    </h2>
                    {lessons.length ? (
                      <span className="muted small">
                        {completed} of {lessons.length} complete
                      </span>
                    ) : null}
                  </div>
                  {lessons.length ? (
                    <div className="lesson-list">
                      {lessons.map((l, i) => (
                        <button
                          className="lesson-row"
                          key={l.id}
                          onClick={() =>
                            setEditing({ kind: "lesson", record: l })
                          }
                        >
                          <span
                            className={`step-number ${l.data.status === "completed" ? "complete" : ""}`}
                          >
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span>
                            <strong>{s(l.data.title)}</strong>
                            <small>
                              {s(l.data.status).replaceAll("_", " ")}
                            </small>
                          </span>
                        </button>
                      ))}
                      <ArcadeProgress
                        value={completed}
                        max={lessons.length}
                        label="Self-reported lesson progress"
                      />
                    </div>
                  ) : (
                    <p className="empty-state">
                      No learning steps yet.
                      <br />
                      Add a skill or topic you want to practice.
                    </p>
                  )}
                  <footer className="panel-footer">
                    <button
                      className="text-button"
                      onClick={() => setEditing({ kind: "lesson" })}
                    >
                      Add learning step
                    </button>
                  </footer>
                </section>
              ) : null}
              {view === "today" || view === "context" ? (
                <section className="panel context-panel">
                  <div className="panel-heading">
                    <h2>
                      <Icon name="context" />
                      Captured context
                    </h2>
                  </div>
                  {view === "context" ? (
                    <label className="search-label">
                      Search captures
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search content"
                      />
                    </label>
                  ) : null}
                  {captures.length ? (
                    <div className="capture-list">
                      {captures
                        .filter((c) =>
                          s(c.data.content)
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                        )
                        .map((c) => (
                          <button
                            className="capture-card"
                            key={c.id}
                            onClick={() => setDetail(c)}
                          >
                            <div className="capture-meta">
                              <span>{s(c.data.type).replaceAll("_", " ")}</span>
                              {c.data.isTest ? <Badge>Sample</Badge> : null}
                            </div>
                            <strong>{s(c.data.content)}</strong>
                            {!c.data.userAccepted ? (
                              <small>
                                {["rejected", "archived"].includes(
                                  s(c.data.disposition),
                                )
                                  ? s(c.data.disposition)
                                  : "Needs review"}
                              </small>
                            ) : null}
                          </button>
                        ))}
                      {!captures.some((c) =>
                        s(c.data.content)
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                      ) ? (
                        <p className="muted">No matching captures.</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="empty-state">
                      No captured context yet.
                      <br />
                      Import a report to save decisions and details.
                    </p>
                  )}
                  <footer className="panel-footer">
                    <span />
                    <button
                      className="text-button"
                      onClick={() => setImporting(true)}
                    >
                      Import report
                    </button>
                  </footer>
                </section>
              ) : null}
            </div>
            {view === "today" &&
            meetings.some((m) => !dayMeetings.includes(m)) ? (
              <section className="panel secondary-panel">
                <h2>Other meetings</h2>
                {meetings
                  .filter((m) => !dayMeetings.includes(m))
                  .map((m) => (
                    <button
                      className="meeting-row"
                      key={m.id}
                      onClick={() => setEditing({ kind: "meeting", record: m })}
                    >
                      <span>
                        <strong>{s(m.data.title)}</strong>
                        <small>{stamp(m.data.start)}</small>
                      </span>
                    </button>
                  ))}
              </section>
            ) : null}
            {view === "today" ? (
              <section className="notes-section">
                <div className="section-heading">
                  <h2>
                    <Icon name="note" />
                    Notes
                  </h2>
                  <button
                    className="secondary"
                    onClick={() => setEditing({ kind: "note" })}
                  >
                    Add note
                  </button>
                </div>
                {notes.length ? (
                  <div className="notes-list">
                    {notes.map((n) => (
                      <button
                        key={n.id}
                        className="note-card"
                        onClick={() => setEditing({ kind: "note", record: n })}
                      >
                        <strong>{s(n.data.title)}</strong>
                        <p>{s(n.data.content)}</p>
                        <small>{stamp(n.updatedAt)}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No notes yet.</p>
                )}
              </section>
            ) : null}
            {view === "learning" ? (
              <p className="section-note">
                Completion follows your own practice and evidence notes.
              </p>
            ) : null}
            {view === "agents" ? (
              <>
                <section className="panel secondary-panel">
                  <div className="panel-heading">
                    <h2>Report history</h2>
                    <span className="muted small">
                      {reports.length}{" "}
                      {reports.length === 1 ? "report" : "reports"}
                    </span>
                  </div>
                  {reports.length ? (
                    reports.map((r) => (
                      <button
                        className="history-row"
                        key={`${r.connectionId}:${r.report.eventId}`}
                        onClick={() => setDetail(r)}
                      >
                        <span>
                          <strong>{r.report.summary}</strong>
                          <small>
                            {stamp(r.report.occurredAt)}
                            {r.report.isTest ? " / Sample report" : ""}
                          </small>
                        </span>
                        <span aria-hidden="true">&gt;</span>
                      </button>
                    ))
                  ) : (
                    <p>No reports received.</p>
                  )}
                </section>
                <Connections />
                <AgentJournal />
              </>
            ) : null}
          </>
        )}
        <footer className="workspace-footer">
          <span>
            {!snapshot
              ? error
                ? "Storage unavailable"
                : "Connecting..."
              : snapshot.storageMode === "supabase"
                ? "Private workspace"
                : "Local workspace"}
          </span>
          <a href="#calendar">Calendar and meeting settings</a>
        </footer>
      </main>
      {assistant && snapshot ? (
        <AssistantPanel workspaceId={snapshot.workspaceId} records={records} contextId={assistant.contextId} initialPrompt={assistant.prompt} onClose={() => setAssistant(null)} onChanged={refresh} onBusy={setAssistantBusy} />
      ) : null}
      {historyOpen ? (
        <CommandHistory
          onClose={() => setHistoryOpen(false)}
          onChanged={refresh}
        />
      ) : null}
      {commandOpen && snapshot ? (
        <CommandReview
          key={snapshot.workspaceId}
          workspaceId={snapshot.workspaceId}
          records={records}
          onClose={() => setCommandOpen(false)}
          onChanged={refresh}
        />
      ) : null}
      {editing ? (
        <Editor
          target={editing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
      {importing ? (
        <ReportImport
          onClose={() => setImporting(false)}
          onImport={importReport}
        />
      ) : null}
      {detail ? (
        <Modal
          title={"report" in detail ? "Report details" : "Captured context"}
          onClose={() => setDetail(null)}
        >
          {"report" in detail ? (
            <div className="detail">
              {detail.report.isTest ? <Badge>Sample report</Badge> : null}
              <p className="detail-summary">{detail.report.summary}</p>
              <p className="muted">
                Reported {stamp(detail.report.occurredAt)}
              </p>
              <details>
                <summary>Source and receipt</summary>
                <dl>
                  <dt>Saved</dt>
                  <dd>{stamp(detail.receipt.committedAt)}</dd>
                  <dt>Receipt</dt>
                  <dd>{detail.receipt.receiptId}</dd>
                  <dt>Connection</dt>
                  <dd>{detail.connectionId}</dd>
                  <dt>Event</dt>
                  <dd>{detail.report.eventId}</dd>
                  <dt>Source</dt>
                  <dd>
                    {detail.report.source.conversationRef ?? "Not provided"}
                  </dd>
                  <dt>Payload digest</dt>
                  <dd>{detail.receipt.payloadDigest}</dd>
                </dl>
                <p className="muted">
                  This receipt confirms the report was saved here. Remote memory
                  and ongoing activity are not verified.
                </p>
              </details>
            </div>
          ) : (
            <div className="detail">
              <p className="detail-summary">{s(detail.data.content)}</p>
              <p>
                {detail.data.userAccepted
                  ? "Accepted"
                  : s(detail.data.disposition) || "Needs review"}
              </p>
              <details>
                <summary>Source and history</summary>
                <dl>
                  <dt>Basis</dt>
                  <dd>{s(detail.data.basis)}</dd>
                  <dt>Source event</dt>
                  <dd>{s(detail.data.eventId)}</dd>
                  <dt>Reported</dt>
                  <dd>{stamp(detail.data.occurredAt)}</dd>
                  <dt>Updated</dt>
                  <dd>{stamp(detail.updatedAt)}</dd>
                  <dt>Source</dt>
                  <dd>
                    {s(
                      (detail.data.source as Record<string, unknown>)
                        ?.conversationRef,
                    ) || "Not provided"}
                  </dd>
                  <dt>Revision</dt>
                  <dd>{detail.revision}</dd>
                </dl>
                <p className="muted">
                  Changes here are not synced to the assistant.
                </p>
              </details>
              <footer className="form-actions">
                <button
                  className="primary"
                  onClick={() => {
                    setEditing({ kind: "capture", record: detail });
                    setDetail(null);
                  }}
                >
                  Review capture
                </button>
              </footer>
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
