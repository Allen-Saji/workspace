"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  AgentJournalView,
  JournalDay,
  PersonalEntry,
  PersonalWrite,
} from "../journal/personal";
import { personalWrite } from "../journal/personal";
import { localDateAt } from "../journal/contracts";
import { Modal, stamp } from "./primitives";
import styles from "./JournalPanel.module.css";
import { useWorkspaceReads } from "./WorkspaceReads";

const noSubscription = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const localDay = () => localDateAt(Date.now(), browserZone());
const headers = {
  "Content-Type": "application/json",
  "X-Workspace-Request": "local-ui",
};
const unavailableDrafts = new Set<string>();
const draftStorageEvent = "workspace-journal-draft-storage";
function subscribeDraftStorage(notify: () => void) {
  window.addEventListener(draftStorageEvent, notify);
  return () => window.removeEventListener(draftStorageEvent, notify);
}
const messages: Record<string, string> = {
  journal_revision_conflict:
    "This entry changed elsewhere. Your draft is preserved. Compare the saved version before saving again.",
  idempotency_conflict:
    "This save request already belongs to different text. Recover the original save before editing again.",
  auth_required: "Sign in again to read or save your journal.",
  storage_unavailable:
    "Journal storage is unavailable. Your text is preserved in this tab.",
  journal_future_date: "Choose today or an earlier date.",
  timezone_conflict:
    "This day has a different saved timezone. Load the saved entry before editing it.",
};
async function json(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(
        messages[body.error?.code] ??
          "Could not load or save the journal. Your draft is preserved.",
      ),
      { code: body.error?.code },
    );
  return body;
}
type Draft = {
  content: string;
  expectedRevision: number;
  timezone: string;
  pending: PersonalWrite | null;
};
function readDraft(
  key: string,
  saved: PersonalEntry | null,
  zone: string,
  date: string,
): Draft {
  const initial = {
    content: saved?.content ?? "",
    expectedRevision: saved?.revision ?? 0,
    timezone: saved?.timezone ?? zone,
    pending: null,
  };
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      !value ||
      typeof value.content !== "string" ||
      value.content.length > 12000 ||
      !Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 0 ||
      typeof value.timezone !== "string"
    )
      return initial;
    new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(0);
    const pending = value.pending ? personalWrite(value.pending) : null;
    if (pending && pending.localDate !== date) return initial;
    return {
      content: value.content,
      expectedRevision: value.expectedRevision,
      timezone: value.timezone,
      pending,
    };
  } catch {
    return initial;
  }
}

function JournalEditor({
  workspaceId,
  date,
  zone,
  saved,
  onSaved,
}: {
  workspaceId: string;
  date: string;
  zone: string;
  saved: PersonalEntry | null;
  onSaved: () => Promise<void>;
}) {
  const key = `workspace-journal-draft-v1:${workspaceId}:${date}`;
  const [draft, setDraft] = useState<Draft>(() =>
    readDraft(key, saved, zone, date),
  );
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const draftStored = useSyncExternalStore(
    subscribeDraftStorage,
    () => !unavailableDrafts.has(key),
    () => true,
  );
  const lock = useRef(false);
  const dirty = draft.content !== (saved?.content ?? "");
  const stale = draft.expectedRevision !== (saved?.revision ?? 0);
  useEffect(() => {
    try {
      if (dirty || draft.pending)
        sessionStorage.setItem(key, JSON.stringify(draft));
      else sessionStorage.removeItem(key);
      if (unavailableDrafts.delete(key))
        window.dispatchEvent(new Event(draftStorageEvent));
    } catch {
      if (!unavailableDrafts.has(key)) {
        unavailableDrafts.add(key);
        window.dispatchEvent(new Event(draftStorageEvent));
      }
    }
  }, [key, dirty, draft]);
  useEffect(() => {
    if (!dirty && !draft.pending) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, draft.pending]);
  async function save() {
    if (lock.current || !draft.content.trim()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const input = draft.pending ?? {
      requestId: crypto.randomUUID(),
      localDate: date,
      timezone: draft.timezone,
      expectedRevision: draft.expectedRevision,
      content: draft.content,
    };
    setDraft((previous) => ({ ...previous, pending: input }));
    try {
      const result = await json(
        await fetch("/api/journal", {
          method: "POST",
          headers,
          body: JSON.stringify({ action: "save", entry: input }),
          signal: AbortSignal.timeout(20000),
        }),
      );
      const entry = result.entry as PersonalEntry;
      setDraft({
        content: entry.content,
        timezone: entry.timezone,
        expectedRevision: entry.revision,
        pending: null,
      });
      setNotice("Journal saved.");
      await onSaved();
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        [
          "journal_revision_conflict",
          "timezone_conflict",
          "invalid_text",
          "journal_future_date",
        ].includes(String(error.code))
      )
        setDraft((previous) => ({ ...previous, pending: null }));
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "journal_revision_conflict"
      ) {
        try {
          await onSaved();
        } catch {
          /* The preserved draft can be refreshed again. */
        }
      }
      setError(
        error instanceof Error
          ? error.message
          : "Save outcome is unknown. Recover this save before editing again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className={styles.editor} aria-label="Your daily journal">
      <div className={styles.editorHeading}>
        <div>
          <span className={styles.eyebrow}>Your journal</span>
          <h2>
            {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </h2>
        </div>
        <span className={styles.small}>
          {saved ? `Saved ${stamp(saved.updatedAt)}` : "No saved entry"}
        </span>
      </div>
      <label htmlFor="personal-journal">Entry</label>
      <p className={styles.hint}>Type or dictate with Wispr Flow.</p>
      <textarea
        id="personal-journal"
        rows={14}
        maxLength={12000}
        value={draft.content}
        disabled={busy || !!draft.pending}
        placeholder="Write about your day..."
        onChange={(event) => {
          setDraft((previous) => ({
            ...previous,
            content: event.target.value,
          }));
          setNotice("");
        }}
      />
      <div className={styles.draftMeta}>
        <span>{draft.content.length.toLocaleString()} / 12,000 characters</span>
        <span>
          {draft.pending
            ? "Save pending recovery"
            : dirty
              ? draftStored
                ? "Unsaved draft kept in this tab"
                : "Unsaved draft (browser storage unavailable)"
              : saved
                ? `Revision ${saved.revision}`
                : "Not saved yet"}
        </span>
      </div>
      {stale ? (
        <div className={styles.conflict} role="alert">
          <p>
            Your draft is based on an older revision. The saved entry has
            changed; your text has been kept.
          </p>
          <details>
            <summary>Compare the saved entry</summary>
            <p className={styles.entryText}>
              {saved?.content ?? "No saved entry."}
            </p>
          </details>
          <button
            className="secondary"
            disabled={busy || !!draft.pending}
            onClick={() => {
              setDraft({
                content: saved?.content ?? "",
                expectedRevision: saved?.revision ?? 0,
                timezone: saved?.timezone ?? zone,
                pending: null,
              });
              setError("");
            }}
          >
            Use saved entry
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.editorActions}>
        <button
          className="primary"
          disabled={
            busy ||
            !draft.content.trim() ||
            (!draft.pending && (!dirty || stale))
          }
          onClick={() => void save()}
        >
          {busy ? "Saving..." : draft.pending ? "Recover save" : "Save journal"}
        </button>
        <span role="status" className={styles.small}>
          {notice}
        </span>
      </div>
      <p className={styles.small}>Only you can access your personal journal.</p>
    </section>
  );
}

export default function JournalPanel({
  workspaceId,
  refreshKey,
}: {
  workspaceId: string;
  refreshKey: number;
}) {
  const { read, peek, invalidate } = useWorkspaceReads();
  const today = useSyncExternalStore(noSubscription, localDay, () => "");
  const zone = useSyncExternalStore(
    noSubscription,
    browserZone,
    () => "Asia/Kolkata",
  );
  const [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState<"you" | "agents">("you");
  const date = selected ?? today;
  const [loaded, setLoaded] = useState<{
    date: string;
    day: JournalDay;
  } | null>(() => {
    const day = peek<JournalDay>(`/api/journal?date=${date}`);
    return day ? { date, day } : null;
  });
  const [agents, setAgents] = useState<AgentJournalView | null>(
    () => peek<AgentJournalView>("/api/journal?view=agents") ?? null,
  );
  const [error, setError] = useState(""),
    [history, setHistory] = useState<{
      date: string;
      entries: PersonalEntry[];
    } | null>(null),
    [guide, setGuide] = useState(false),
    [filter, setFilter] = useState("all");
  const [reload, setReload] = useState(0);
  const historySequence = useRef(0);
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    Promise.all([
      read(`/api/journal?date=${date}`, {
        signal: controller.signal,
      }).then(json),
      read("/api/journal?view=agents", {
        signal: controller.signal,
      }).then(json),
    ])
      .then(([day, agentData]) => {
        if (controller.signal.aborted) return;
        setLoaded({ date, day });
        setAgents(agentData);
        setError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Could not load journal.",
          );
      });
    return () => controller.abort();
  }, [date, refreshKey, reload, read]);
  async function refresh() {
    // Reload the active selection through the same abortable effect as navigation.
    invalidate("/api/journal");
    setReload((value) => value + 1);
  }
  async function revisions() {
    const sequence = ++historySequence.current;
    try {
      const data = await json(
        await read(`/api/journal?view=history&date=${date}`),
      );
      if (sequence === historySequence.current)
        setHistory({ date, entries: data.entries });
    } catch (error) {
      if (sequence !== historySequence.current) return;
      setError(
        error instanceof Error ? error.message : "Could not load revisions.",
      );
    }
  }
  const day = loaded?.date === date ? loaded.day : null;
  const visible =
    agents?.diaries.filter(
      (entry) =>
        entry.localDate === date &&
        (filter === "all" || entry.connectionId === filter),
    ) ?? [];
  const name = (id: string) => agents?.names[id] ?? `Agent ${id.slice(0, 8)}`;
  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <div className={styles.tabs} role="group" aria-label="Journal author">
          <button aria-pressed={tab === "you"} onClick={() => setTab("you")}>
            Your journal
          </button>
          <button
            aria-pressed={tab === "agents"}
            onClick={() => setTab("agents")}
          >
            Agent journals
          </button>
        </div>
        <label className={styles.date}>
          Date
          <input
            aria-label="Journal date"
            type="date"
            value={date}
            max={today}
            onChange={(event) => {
              if (event.target.value) setSelected(event.target.value);
            }}
          />
        </label>
        <button
          className="text-button"
          onClick={() => {
            invalidate("/api/journal");
            setSelected(null);
            setReload((value) => value + 1);
          }}
        >
          Today
        </button>
      </div>
      {error ? (
        <div role="alert" className="error">
          {error}{" "}
          <button className="text-button" onClick={() => void refresh()}>
            Retry journal
          </button>
        </div>
      ) : null}
      {tab === "you" ? (
        <div className={styles.layout}>
          {day && date ? (
            <JournalEditor
              key={`${workspaceId}:${date}:${day.entry?.revision ?? 0}`}
              workspaceId={workspaceId}
              date={date}
              zone={zone}
              saved={day.entry}
              onSaved={refresh}
            />
          ) : (
            <p role="status">Loading your journal...</p>
          )}
          <aside className={styles.sidebar}>
            <section className={styles.card}>
              <h2>Recent entries</h2>
              {day?.recent.length ? (
                <ul className={styles.recent}>
                  {day.recent.map((entry) => (
                    <li key={entry.localDate}>
                      <button
                        aria-current={
                          entry.localDate === date ? "date" : undefined
                        }
                        onClick={() => setSelected(entry.localDate)}
                      >
                        <span>{entry.localDate}</span>
                        <small>Revision {entry.revision}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.small}>
                  Your saved days will appear here.
                </p>
              )}
              {day?.entry ? (
                <button
                  className="text-button"
                  onClick={() => void revisions()}
                >
                  View earlier revisions
                </button>
              ) : null}
            </section>
          </aside>
        </div>
      ) : (
        <section
          className={styles.agentView}
          aria-label="Connected agent journals"
        >
          <div className={styles.agentHeading}>
            <div>
              <h2>From your agents</h2>
              <p className={styles.small}>
                Each entry belongs to the connection that published it.
              </p>
            </div>
            <button className="secondary" onClick={() => setGuide(true)}>
              Publishing guide
            </button>
          </div>
          {agents?.enabled === false ? (
            <p className={styles.notice}>
              New agent publishing is currently disabled. Saved entries remain
              readable. Manage connections from <a href="#agents">Agents</a>.
            </p>
          ) : null}
          <label htmlFor="journal-author">Agent</label>
          <select
            id="journal-author"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All agents</option>
            {Object.entries(agents?.names ?? {}).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          {visible.map((entry) => (
            <article
              className={styles.agentEntry}
              key={`${entry.connectionId}:${entry.localDate}`}
            >
              <div className={styles.agentHeading}>
                <h3>{name(entry.connectionId)}</h3>
                <span className={styles.small}>
                  {entry.localDate}
                  {entry.report.isTest ? " / Sample" : ""}
                </span>
              </div>
              <p className={styles.entryText}>{entry.report.summary}</p>
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
                      {entry.report[field].map((text, i) => (
                        <li key={i}>{text}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              {entry.report.evidence.length ? (
                <ul>
                  {entry.report.evidence.map((evidence, i) => (
                    <li key={i}>
                      <a
                        href={evidence.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {evidence.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className={styles.small}>
                Agent-reported / Revision {entry.revision} / {entry.timezone} /
                Received {stamp(entry.receivedAt)}
              </p>
            </article>
          ))}
          {!visible.length ? (
            <div className={styles.empty}>
              <h3>No matching entries</h3>
              <p>No entries for this date among the latest 100 reports.</p>
            </div>
          ) : null}
        </section>
      )}
      {history?.date === date ? (
        <Modal
          title={`Journal revisions / ${history.date}`}
          onClose={() => setHistory(null)}
        >
          <p className={styles.small}>
            The last 20 saved revisions. These snapshots do not replace your
            current entry.
          </p>
          {history.entries.map((entry) => (
            <details className={styles.revision} key={entry.revision}>
              <summary>
                Revision {entry.revision} / {stamp(entry.updatedAt)}
              </summary>
              <p className={styles.entryText}>{entry.content}</p>
            </details>
          ))}
        </Modal>
      ) : null}
      {guide ? (
        <Modal title="Agent journal publishing" onClose={() => setGuide(false)}>
          <p>
            Give your agent the reporting skill and use an approved Workspace
            connection.
          </p>
          <p>
            <a
              href="/skills/workspace-reporting/SKILL.md"
              target="_blank"
              rel="noreferrer"
            >
              Open the Workspace reporting skill
            </a>
          </p>
          <label>
            Request to give your agent
            <textarea
              rows={6}
              readOnly
              value={`Use the Workspace reporting skill at ${window.location.origin}/skills/workspace-reporting/SKILL.md. Publish my approved project's daily journal: what you did, results, blockers, next steps and intentional evidence links. Use one revisable entry per local day. Check capabilities first and use only your approved connection. If publishing is disabled or your connection is missing, report that instead of creating credentials or claiming delivery.`}
            />
          </label>
          <p className={styles.small}>
            Publishing uses the existing scoped agent protocol. This page does
            not install a schedule or issue credentials. Agents cannot read or
            edit your personal journal.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
