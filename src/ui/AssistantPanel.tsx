"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WorkspaceRecord } from "../domain/contracts";
import type { Proposal, CommandReceipt } from "../domain/commands";
import { Modal } from "./primitives";
import RobotSprite from "./RobotSprite";
import { useVoiceInput } from "./useVoiceInput";
import styles from "./AssistantPanel.module.css";

type CalendarEvent = {
  title: string;
  start: string;
  end: string;
  attendees?: string[];
  calendarId?: string;
  createMeet?: boolean;
};
type Reply = {
  reply: string;
  proposal?: Proposal;
  receipt?: CommandReceipt;
  calendarProposal?: { proposal: string; event: CalendarEvent };
  events?: CalendarEvent[];
  slots?: { start: string; end: string }[];
};
type RequestBody = {
  requestId: string;
  text: string;
  contextId?: string;
  history: { role: "user" | "assistant"; text: string }[];
  autoApply: boolean;
};
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  result?: Reply;
  calendarSaved?: boolean;
  calendarExpired?: boolean;
};
type Status = {
  available: boolean;
  reason?: string;
  timezone: string;
  budget?: { limitUsd: number; usedUsd: number };
};
const subscribe = () => () => {};
const hasSpeech = () => "speechSynthesis" in window;
const headers = {
  "Content-Type": "application/json",
  "X-Workspace-Request": "local-ui",
};
const previewLabels: Record<string, string> = {title: "Title", status: "Status", dueDate: "Due date", content: "Content", start: "Starts", end: "Ends"};
const taskStatuses: Record<string, string> = {ready: "To do", in_progress: "In progress", done: "Done"};
function previewValue(key: string, value: unknown) {
  if (value === "" || value == null) return "Not set";
  if (key === "status") return taskStatuses[String(value)] ?? String(value);
  if (key === "start" || key === "end") return when(String(value));
  return String(value);
}
function when(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " IST"
    : value;
}
function errorMessage(
  result: { error?: { message?: string; code?: string } | string },
  status: number,
) {
  const code =
    typeof result.error === "string" ? result.error : result.error?.code;
  const messages: Record<string, string> = {
    assistant_budget_exhausted:
      "The daily $1 AI limit has been reached. It resets at midnight UTC.",
    assistant_request_pending:
      "The previous request has an unknown outcome. Refresh your workspace and check command history before retrying. Do not submit it as a new request.",
    assistant_not_enabled:
      "The assistant is not enabled for this workspace yet.",
    calendar_not_connected:
      "Connect Google Calendar from the Calendar screen first.",
    assistant_context_too_large:
      "This request needs less context. Try one specific task or meeting.",
    assistant_incomplete:
      "The assistant could not finish this response. No proposal is available to review.",
    assistant_refused:
      "The assistant could not help with that request. Try describing a workspace task.",
    assistant_rate_limited:
      "The AI provider is busy. Your request is preserved; try again later.",
    auth_required: "Sign in again to use the assistant.",
    storage_unavailable:
      "Workspace storage is unavailable. Your request is preserved.",
    calendar_reconnect_required:
      "Reconnect Google Calendar from the Calendar screen.",
    assistant_unavailable:
      "The assistant is temporarily unavailable. Your request is preserved.",
  };
  return (
    (code && messages[code]) ||
    (typeof result.error === "string"
      ? result.error
      : (result.error?.message ?? code ?? `Request failed (${status}).`))
  );
}
function pendingRequests(workspaceId?: string): RequestBody[] {
  if (!workspaceId || typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(
      `workspace-assistant-pending-${workspaceId}`,
    );
    if (!raw) return [];
    const value = JSON.parse(raw);
    return (Array.isArray(value) ? value : [value]).filter(
      (item: RequestBody) =>
        typeof item.requestId === "string" &&
        typeof item.text === "string" &&
        Array.isArray(item.history),
    );
  } catch {
    return [];
  }
}
function pendingCalendar(workspaceId?: string): Message[] {
  if (!workspaceId || typeof window === "undefined") return [];
  try {
    const value = JSON.parse(
      sessionStorage.getItem(`workspace-assistant-calendar-${workspaceId}`) ??
        "[]",
    ) as { id: string; calendarProposal: Reply["calendarProposal"] }[];
    return Array.isArray(value)
      ? value
          .filter(
            (item) =>
              item.calendarProposal?.proposal && item.calendarProposal.event,
          )
          .map((item) => ({
            id: item.id,
            role: "assistant",
            text: "Review your pending calendar event.",
            result: {
              reply: "Review your pending calendar event.",
              calendarProposal: item.calendarProposal,
            },
          }))
      : [];
  } catch {
    return [];
  }
}
export default function AssistantPanel({
  records,
  workspaceId,
  contextId,
  initialPrompt = "",
  onClose,
  onChanged,
  onBusy,
}: {
  records: WorkspaceRecord[];
  workspaceId?: string;
  contextId?: string;
  initialPrompt?: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onBusy?: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [statusFailed, setStatusFailed] = useState(false);
  const [text, setText] = useState(initialPrompt);
  const [savedRequests] = useState(() => pendingRequests(workspaceId));
  const savedRequest = savedRequests[0];
  const [heldRequests, setHeldRequests] = useState<RequestBody[]>(
    savedRequests.slice(1),
  );
  const [messages, setMessages] = useState<Message[]>(() => [
    ...pendingCalendar(workspaceId),
    ...(savedRequest
      ? [
          {
            id: savedRequest.requestId,
            role: "user" as const,
            text: savedRequest.text,
          },
        ]
      : []),
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<RequestBody | null>(savedRequest ?? null);
  const [autoApply, setAutoApply] = useState(true);
  const [speak, setSpeak] = useState(false);
  const speechSupported = useSyncExternalStore(
    subscribe,
    hasSpeech,
    () => false,
  );
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const log = useRef<HTMLDivElement>(null);
  const voicePrefix = useRef("");
  const busyCallback = useRef(onBusy);
  const voice = useVoiceInput((transcript) => {
    setStatusAttempt(value => value + 1);
    setText(
      [voicePrefix.current, transcript]
        .filter(Boolean)
        .join(" ")
        .slice(0, 4000),
    );
  });
  const context = records.find((record) => record.id === contextId);
  useEffect(() => {
    busyCallback.current = onBusy;
  }, [onBusy]);
  useEffect(() => {
    if (!workspaceId) return;
    try {
      const key = `workspace-assistant-pending-${workspaceId}`;
      const pending = [
        ...(retry ? [retry] : []),
        ...heldRequests.filter((item) => item.requestId !== retry?.requestId),
      ];
      if (pending.length) sessionStorage.setItem(key, JSON.stringify(pending));
      else sessionStorage.removeItem(key);
    } catch {
      /* Retry still works while this panel stays open. */
    }
  }, [retry, heldRequests, workspaceId]);
  useEffect(() => {
    if (!workspaceId) return;
    try {
      const key = `workspace-assistant-calendar-${workspaceId}`;
      const pending = messages
        .filter(
          (item) =>
            item.result?.calendarProposal &&
            !item.calendarSaved &&
            !item.calendarExpired,
        )
        .map((item) => ({
          id: item.id,
          calendarProposal: item.result!.calendarProposal,
        }));
      if (pending.length) sessionStorage.setItem(key, JSON.stringify(pending));
      else sessionStorage.removeItem(key);
    } catch {
      /* The proposal remains available in this open panel. */
    }
  }, [messages, workspaceId]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      window.speechSynthesis?.cancel();
      busyCallback.current?.(false);
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/assistant", { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(errorMessage(data, response.status));
        setStatus(data);
        setStatusFailed(false);
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setStatusFailed(true);
          setError(
            e instanceof Error ? e.message : "Could not load assistant status.",
          );
        }
      });
    return () => abort.abort();
  }, [statusAttempt]);
  useEffect(() => {
    log.current?.scrollTo({
      top: log.current.scrollHeight,
      behavior: "instant",
    });
  }, [messages, busy]);
  function begin() {
    if (lock.current) return null;
    lock.current = true;
    setBusy(true);
    busyCallback.current?.(true);
    setError("");
    voice.cancel();
    const abort = new AbortController();
    controller.current = abort;
    return abort;
  }
  function finish() {
    lock.current = false;
    if (alive.current) {
      setBusy(false);
      busyCallback.current?.(false);
    }
  }
  async function refreshRecords() {
    try {
      await onChanged();
    } catch {
      if (alive.current)
        setError(
          "Your change was saved, but the workspace could not refresh. Refresh the page to see it.",
        );
    }
  }
  async function send(body?: RequestBody) {
    if (voice.requesting || voice.listening || voice.processing) return;
    if (!body && (!text.trim() || retry || !status?.available)) return;
    const abort = begin();
    if (!abort) return;
    const request: RequestBody = body ?? {
      requestId: crypto.randomUUID(),
      text: text.trim(),
      contextId,
      history: messages
        .slice(-12)
        .map((m) => ({ role: m.role, text: m.text.slice(0, 3000) })),
      autoApply,
    };
    if (!body) {
      setMessages((all) => [
        ...all,
        { id: request.requestId, role: "user", text: request.text },
      ]);
      setText("");
    }
    setRetry(request);
    const timeout = setTimeout(() => abort.abort(), 60000);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: abort.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(errorMessage(data, response.status));
      const result = data as Reply;
      if (!alive.current) return;
      setMessages((all) => [
        ...all,
        {
          id: `${request.requestId}-reply`,
          role: "assistant",
          text: result.reply,
          result,
        },
      ]);
      setRetry(null);
      setHeldRequests((all) =>
        all.filter((item) => item.requestId !== request.requestId),
      );
      setStatusAttempt((value) => value + 1);
      if (result.receipt) await refreshRecords();
      if (speak && speechSupported) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(result.reply);
        utterance.lang = "en-IN";
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error && e.name !== "AbortError"
            ? `${e.message} Retry uses the same request, so a saved action will not be repeated.`
            : "The response was interrupted. The outcome may already be saved. Retry the same request to recover it.",
        );
    } finally {
      clearTimeout(timeout);
      finish();
    }
  }
  async function act(message: Message, action: "apply" | "undo" | "calendar") {
    const abort = begin();
    if (!abort || !message.result) return;
    const result = message.result;
    const timeout = setTimeout(() => abort.abort(), 45000);
    try {
      const response = await fetch(
        action === "calendar" ? "/api/calendar" : "/api/commands",
        {
          method: "POST",
          headers,
          signal: abort.signal,
          body: JSON.stringify(
            action === "calendar"
              ? {
                  action: "apply",
                  proposal: result.calendarProposal?.proposal,
                  confirmed: true,
                }
              : action === "apply"
                ? { action, proposal: result.proposal }
                : { action, commandId: result.receipt?.commandId },
          ),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        if (data.error?.code === "calendar_proposal_expired")
          setMessages((all) =>
            all.map((item) =>
              item.id === message.id
                ? { ...item, calendarExpired: true }
                : item,
            ),
          );
        throw new Error(errorMessage(data, response.status));
      }
      if (!alive.current) return;
      setMessages((all) =>
        all.map((item) =>
          item.id === message.id
            ? {
                ...item,
                calendarSaved: action === "calendar" || item.calendarSaved,
                result: {
                  ...item.result!,
                  ...(data.receipt ? { receipt: data.receipt } : {}),
                },
              }
            : item,
        ),
      );
      await refreshRecords();
    } catch (e) {
      if (alive.current)
        setError(
          `${e instanceof Error ? e.message : "Request interrupted."} You can retry this same action to check its result.`,
        );
    } finally {
      clearTimeout(timeout);
      finish();
    }
  }
  return (
    <Modal
      title="Workspace assistant"
      onClose={() => {
        if (!lock.current) {
          voice.cancel();
          onClose();
        } else
          setError(
            "Please wait for this request to finish so its result stays visible.",
          );
      }}
    >
      <div className={styles.panel}>
        <div className={styles.intro}>
          <RobotSprite
            pose={busy ? "working" : voice.listening ? "wave" : "idle"}
            animated
            className={styles.robot}
          />
          <div>
            <strong>What would you like to get done?</strong>
            <p>Tasks, notes, and your calendar. Type or talk.</p>
          </div>
        </div>
        {context && (
          <div className={styles.context}>
            Current {context.kind}:{" "}
            <strong>{String(context.data.title ?? "Untitled")}</strong>
          </div>
        )}
        {!status ? (
          <p role="status" className={styles.hint}>
            {statusFailed
              ? "Assistant unavailable."
              : "Checking assistant availability..."}{" "}
            <button
              className="text-button"
              onClick={() => setStatusAttempt((value) => value + 1)}
            >
              Retry
            </button>
          </p>
        ) : !status.available ? (
          <div className={styles.context}>
            {status.reason ??
              "The assistant is not configured yet. Manual workspace controls are still available."}
          </div>
        ) : null}
        <div
          className={styles.messages}
          ref={log}
          role="log"
          aria-label="Assistant conversation"
          aria-live="polite"
        >
          {messages.length === 0 && (
            <div className={styles.examples}>
              {[
                "Add a task to review my plans tomorrow",
                "What meetings do I have this week?",
                "Find a free hour tomorrow",
              ].map((prompt) => (
                <button
                  key={prompt}
                  disabled={busy}
                  onClick={() => setText(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          {messages.map((message) => (
            <article
              key={message.id}
              className={`${styles.message} ${message.role === "user" ? styles.user : ""}`}
            >
              <span className={styles.role}>
                {message.role === "user" ? "You" : "Workspace"}
              </span>
              <p>{message.text}</p>
              {message.result?.proposal && !message.result.receipt && (
                <section className={styles.card}>
                  <strong>Review changes</strong>
                  {message.result.proposal.operations.map((op) => (
                    <div key={op.id}>
                      <strong>
                        {op.expectedRevision ? "Edit" : "Create"} {op.kind}
                      </strong>
                      <dl>
                        {Object.entries(op.data).map(([key, value]) => (
                          <div key={key}>
                            <dt>{previewLabels[key] ?? key}</dt>
                            <dd>{previewValue(key, value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void act(message, "apply")}
                  >
                    Apply {message.result.proposal.operations.length}{" "}
                    {message.result.proposal.operations.length === 1
                      ? "change"
                      : "changes"}
                  </button>
                </section>
              )}
              {message.result?.receipt && (
                <section className={styles.card}>
                  <strong>
                    {message.result.receipt.undo
                      ? "Changes undone"
                      : "Saved to your workspace"}
                  </strong>
                  <ul>
                    {message.result.receipt.changes.map((change) => (
                      <li key={change.after.id}>
                        {String(change.after.data.title)}
                      </li>
                    ))}
                  </ul>
                  {!message.result.receipt.undo && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void act(message, "undo")}
                    >
                      Undo
                    </button>
                  )}
                </section>
              )}
              {message.result?.calendarProposal && (
                <section className={styles.card}>
                  <strong>
                    {message.calendarSaved
                      ? "Saved to Google Calendar"
                      : "Review calendar event"}
                  </strong>
                  <dl>
                    <dt>Title</dt>
                    <dd>{message.result.calendarProposal.event.title}</dd>
                    <dt>Starts</dt>
                    <dd>{when(message.result.calendarProposal.event.start)}</dd>
                    <dt>Ends</dt>
                    <dd>{when(message.result.calendarProposal.event.end)}</dd>
                    <dt>Calendar</dt>
                    <dd>
                      {message.result.calendarProposal.event.calendarId ??
                        "Primary calendar"}
                    </dd>
                    <dt>Google Meet</dt>
                    <dd>
                      {message.result.calendarProposal.event.createMeet
                        ? "Yes"
                        : "No"}
                    </dd>
                    <dt>Attendees</dt>
                    <dd>
                      {message.result.calendarProposal.event.attendees?.join(
                        ", ",
                      ) || "Only you"}
                    </dd>
                  </dl>
                  {message.calendarExpired && (
                    <p className={styles.hint}>
                      This preview expired. Check your calendar before asking
                      for a fresh preview.
                    </p>
                  )}
                  {!message.calendarSaved && !message.calendarExpired && (
                    <>
                      <p className={styles.hint}>
                        Confirming saves this event and sends invitations to the
                        attendees listed above.
                      </p>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void act(message, "calendar")}
                      >
                        Confirm and save event
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setMessages((all) => all.map((item) => item.id === message.id ? {
                          ...item,
                          text: "Calendar preview discarded.",
                          result: { ...item.result!, calendarProposal: undefined },
                        } : item))}
                      >
                        Discard preview
                      </button>
                    </>
                  )}
                </section>
              )}
              {message.result?.events?.map((event, i) => (
                <div className={styles.card} key={i}>
                  <strong>{event.title}</strong>
                  <span>
                    {when(event.start)} to {when(event.end)}
                  </span>
                </div>
              ))}
              {message.result?.slots?.map((slot, i) => (
                <div className={styles.card} key={i}>
                  {when(slot.start)} to {when(slot.end)}
                </div>
              ))}
            </article>
          ))}
          {busy && (
            <p role="status" className={styles.hint}>
              Working on your request...
            </p>
          )}
        </div>
        {(error || voice.error || (retry && !busy)) && (
          <div className={styles.error} role="alert">
            {error ||
              voice.error ||
              "A request is waiting for a confirmed response. Recover it before sending another."}
            {retry && !busy && (
              <div>
                <button className="secondary" onClick={() => void send(retry)}>
                  Retry same request
                </button>
                <p className={styles.hint}>
                  This request may already have changed your workspace. Keep it
                  for recovery if you start something else.
                </p>
                <button
                  className="text-button"
                  onClick={() => {
                    setHeldRequests((all) =>
                      all.some((item) => item.requestId === retry.requestId)
                        ? all
                        : [...all, retry],
                    );
                    setRetry(null);
                    setError("");
                  }}
                >
                  Start a different request
                </button>
              </div>
            )}
          </div>
        )}
        {heldRequests.length > 0 && (
          <details className={styles.card}>
            <summary>
              Requests awaiting confirmation ({heldRequests.length})
            </summary>
            <p className={styles.hint}>
              These requests may already have changed your workspace. Check the
              workspace and command history before repeating an action.
            </p>
            {heldRequests.map((request) => (
              <div className={styles.card} key={request.requestId}>
                <p>{request.text}</p>
                <button
                  className="secondary"
                  disabled={busy || !!retry}
                  onClick={() => void send(request)}
                >
                  Recover same request
                </button>
              </div>
            ))}
          </details>
        )}
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor="assistant-request" className={styles.hint}>
            Your request
          </label>
          <textarea
            id="assistant-request"
            value={text}
            maxLength={4000}
            rows={3}
            disabled={
              busy ||
              !!retry ||
              voice.requesting ||
              voice.listening ||
              voice.processing
            }
            placeholder="Tell me what you want to do..."
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (!voice.listening && !voice.processing && !voice.requesting)
                  void send();
              }
            }}
          />
          {(voice.requesting || voice.listening || voice.processing) && (
            <div
              className={`${styles.voiceStatus} ${voice.listening ? styles.recording : ""}`}
            >
              <div className={styles.voiceSummary} role="status">
                <span
                  className={
                    voice.listening ? styles.recordingDot : styles.spinner
                  }
                  aria-hidden="true"
                />
                <strong>
                  {voice.requesting
                    ? "Waiting for microphone"
                    : voice.listening
                      ? "Recording"
                      : "Transcribing..."}
                </strong>
                {voice.listening && (
                  <time aria-hidden="true">
                    00:{String(voice.elapsedSeconds).padStart(2, "0")} / 01:00
                  </time>
                )}
              </div>
              {voice.listening && (
                <>
                  <div className={styles.waveform} aria-hidden="true">
                    {Array.from({ length: 25 }, (_, index) => (
                      <span
                        key={index}
                        style={{
                          height: `${4 + voice.level * (12 + 20 * Math.sin((index + 1) * 1.7) ** 2)}px`,
                        }}
                      />
                    ))}
                  </div>
                  <p>Microphone on. Stop recording to transcribe.</p>
                </>
              )}
              {voice.requesting && (
                <p>Allow microphone access in your browser to continue.</p>
              )}
              {voice.processing && (
                <p>Microphone off. Your transcript will appear above.</p>
              )}
            </div>
          )}
          <div className={styles.toolbar}>
            <button
              type="button"
              className={`secondary ${voice.listening ? styles.listening : ""}`}
              disabled={
                !voice.supported ||
                voice.processing ||
                voice.requesting ||
                busy ||
                !!retry ||
                !status?.available
              }
              aria-pressed={voice.listening}
              onClick={() => {
                if (voice.listening) voice.stop();
                else {
                  voicePrefix.current = text.trim();
                  voice.start();
                }
              }}
            >
              {voice.listening ? "Stop recording" : "Use microphone"}
            </button>
            {(voice.requesting || voice.listening || voice.processing) && (
              <button
                type="button"
                className="text-button"
                onClick={() => voice.cancel()}
              >
                Cancel{" "}
                {voice.listening
                  ? "recording"
                  : voice.processing
                    ? "transcription"
                    : "microphone"}
              </button>
            )}
            {!voice.requesting && !voice.listening && !voice.processing && (
              <button
                type="submit"
                className="primary"
                disabled={
                  busy ||
                  voice.listening ||
                  voice.requesting ||
                  voice.processing ||
                  !!retry ||
                  !text.trim() ||
                  !status?.available
                }
              >
                {busy ? "Working..." : "Send request"}
              </button>
            )}
          </div>
          <div className={styles.options}>
            <label>
              <input
                type="checkbox"
                checked={autoApply}
                disabled={busy}
                onChange={(event) => setAutoApply(event.target.checked)}
              />
              Auto-save single task, note, or meeting changes
            </label>
            {speechSupported && (
              <label>
                <input
                  type="checkbox"
                  checked={speak}
                  onChange={(event) => {
                    setSpeak(event.target.checked);
                    if (!event.target.checked) window.speechSynthesis.cancel();
                  }}
                />
                Read replies aloud
              </label>
            )}
          </div>
          <p className={styles.hint}>
            {voice.supported
              ? "Audio is sent to OpenAI when you stop recording. Review the transcript before sending."
              : "Voice input is unavailable in this browser. You can type your request."}
          </p>
          <details className={styles.privacy}>
            <summary>Privacy and AI usage</summary>
            <p className={styles.hint}>
              Requests and relevant context go to OpenAI. Workspace discards
              recordings after transcription. Each recording reserves $0.05 from
              the daily AI budget. Journal and calendar changes require
              confirmation.
            </p>
          </details>
          {status?.budget && (
            <p className={styles.hint}>
              Reserved today (UTC): ${status.budget.usedUsd.toFixed(3)} of $
              {status.budget.limitUsd.toFixed(2)}.
            </p>
          )}
        </form>
      </div>
    </Modal>
  );
}
