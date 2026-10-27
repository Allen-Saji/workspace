"use client";
import { useEffect, useRef, useState } from "react";
import type { Proposal, CommandReceipt } from "../domain/commands";
import styles from "./CalendarPanel.module.css";
import { useWorkspaceReads } from "./WorkspaceReads";

type Calendar = {
  id: string;
  title: string;
  timeZone: string;
  accessRole: string;
  primary?: boolean;
};
type Event = {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  etag?: string;
  htmlLink?: string;
  joinUrl?: string;
  attendees?: string[];
  createMeet?: boolean;
  recurringEventId?: string;
  originalStartTime?: string;
};
type EventDraft = {
  calendarId: string;
  id?: string;
  etag?: string;
  title: string;
  start: string;
  end: string;
  attendees: string[];
  createMeet: boolean;
};
type Preview = { proposal: string; event: EventDraft };
type Status = {
  configured: boolean;
  connected: boolean;
  reconnectRequired?: boolean;
  reason?: string;
};
const headers = {
  "Content-Type": "application/json",
  "X-Workspace-Request": "local-ui",
};
function localTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (key: string) =>
    parts.find((item) => item.type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
function displayTime(value: string, allDay = false) {
  return allDay
    ? value.slice(0, 10)
    : new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " IST";
}
function link(value?: string) {
  try {
    return value && new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}
function blank(calendarId: string): EventDraft {
  const start = new Date(Math.ceil(Date.now() / 3600000) * 3600000);
  return {
    calendarId,
    title: "",
    start: localTime(start.toISOString()),
    end: localTime(new Date(start.getTime() + 1800000).toISOString()),
    attendees: [],
    createMeet: false,
  };
}
function failure(
  data: { error?: string | { code?: string; message?: string } },
  status: number,
) {
  const code = typeof data.error === "string" ? data.error : data.error?.code;
  const messages: Record<string, string> = {
    calendar_configuration_required:
      "Google Calendar is not configured for this workspace yet. You can still import an .ics file below.",
    calendar_storage_unavailable:
      "Calendar storage is unavailable. Ask the workspace owner to finish calendar setup. You can still import an .ics file.",
    calendar_reconnect_required:
      "Your Google connection needs to be renewed. Reconnect Calendar to continue.",
    calendar_not_connected:
      "Connect Google Calendar before loading or scheduling events.",
    calendar_api_disabled:
      "Enable Google Calendar API in the app's Google Cloud project, then refresh.",
    calendar_permission_denied:
      "Google denied access to this calendar. Check the calendar permissions or reconnect your account.",
    calendar_scope_denied:
      "Calendar access was not granted. Reconnect and approve the requested calendar permissions.",
    calendar_meet_unavailable:
      "This calendar cannot create Google Meet links. Turn off the Meet option or choose another calendar.",
    calendar_provider_unavailable:
      "Google Calendar could not respond. Retry the same action when the connection returns.",
    calendar_revision_conflict:
      "This event changed in Google Calendar. Refresh the agenda and review the latest event before editing it.",
    calendar_recurring_edit_unsupported:
      "Edit recurring events in Google Calendar. This screen edits individual events only.",
    auth_required: "Sign in again to use your calendar.",
  };
  return (
    (code && messages[code]) ||
    (typeof data.error === "string"
      ? data.error
      : (data.error?.message ?? code ?? `Request failed (${status}).`))
  );
}
type Recovery = { preview: Preview; requestId: string; attempted: boolean };
function recover(workspaceId?: string): Recovery | null {
  if (!workspaceId || typeof window === "undefined") return null;
  try {
    const value = JSON.parse(
      sessionStorage.getItem(`workspace-calendar-preview-${workspaceId}`) ??
        "null",
    ) as Recovery | null;
    return value?.preview?.proposal &&
      value.preview.event &&
      typeof value.requestId === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
export default function CalendarPanel({
  workspaceId,
  onChanged,
}: {
  workspaceId?: string;
  onChanged: () => Promise<void> | void;
}) {
  const { read, peek, invalidate } = useWorkspaceReads();
  const [recovery] = useState(() => recover(workspaceId));
  const [status, setStatus] = useState<Status | null>(
    () => peek<Status>("/api/calendar?action=status") ?? null,
  );
  const [calendars, setCalendars] = useState<Calendar[]>(
    () =>
      peek<{ calendars: Calendar[] }>("/api/calendar?action=calendars")
        ?.calendars ?? [],
  );
  const [calendarId, setCalendarId] = useState(
    recovery?.preview.event.calendarId ??
      calendars.find((item) => item.primary)?.id ??
      calendars.find((item) => item.accessRole === "owner")?.id ??
      calendars[0]?.id ??
      "",
  );
  const [eventResult, setEventResult] = useState<{
    key: string;
    events: Event[];
    truncated: boolean;
  } | null>(null);
  const [from, setFrom] = useState(() =>
    localTime(new Date().toISOString()).slice(0, 10),
  );
  const [to, setTo] = useState(() =>
    localTime(new Date(Date.now() + 7 * 86400000).toISOString()).slice(0, 10),
  );
  const [refresh, setRefresh] = useState(0);
  const [loadedRevision, setLoadedRevision] = useState(() => (status ? 0 : -1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<EventDraft | null>(() =>
    recovery
      ? {
          ...recovery.preview.event,
          start: localTime(recovery.preview.event.start),
          end: localTime(recovery.preview.event.end),
        }
      : null,
  );
  const [attendees, setAttendees] = useState(
    recovery?.preview.event.attendees?.join(", ") ?? "",
  );
  const [saveAttempted, setSaveAttempted] = useState(
    recovery?.attempted ?? false,
  );
  const [preview, setPreview] = useState<Preview | null>(
    recovery?.preview ?? null,
  );
  const [imported, setImported] = useState<{
    proposal: Proposal;
    warnings: string[];
    receipt?: CommandReceipt;
  } | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const requestId = useRef<string | null>(recovery?.requestId ?? null);
  const loading = loadedRevision !== refresh;
  const rangeError =
    !from ||
    !to ||
    to <= from ||
    Date.parse(to) - Date.parse(from) > 31 * 86400000
      ? "Choose a calendar range of 1 to 31 days."
      : "";
  const eventKey = `${calendarId}/${from}/${to}/${refresh}`;
  const eventsLoading = Boolean(
    status?.connected &&
      !status.reconnectRequired &&
      calendarId &&
      !rangeError &&
      eventResult?.key !== eventKey,
  );
  const events = eventResult?.key === eventKey ? eventResult.events : [];
  const truncated = eventResult?.key === eventKey && eventResult.truncated;
  const hasDraft = !!draft;
  useEffect(() => {
    if (!workspaceId) return;
    try {
      const key = `workspace-calendar-preview-${workspaceId}`;
      if (preview)
        sessionStorage.setItem(
          key,
          JSON.stringify({
            preview,
            requestId: requestId.current,
            attempted: saveAttempted,
          }),
        );
      else sessionStorage.removeItem(key);
    } catch {
      /* This open panel still retains its signed preview. */
    }
  }, [preview, saveAttempted, workspaceId]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const response = await read("/api/calendar?action=status", {
          signal: abort.signal,
        });
        const data = await response.json();
        if (abort.signal.aborted) return;
        if (!response.ok) throw new Error(failure(data, response.status));
        setStatus(data);
        if (data.connected && !data.reconnectRequired) {
          const result = await read("/api/calendar?action=calendars", {
            signal: abort.signal,
          });
          const list = await result.json();
          if (abort.signal.aborted) return;
          if (!result.ok) {
            if (list.error?.code === "calendar_reconnect_required")
              setStatus({
                configured: true,
                connected: false,
                reconnectRequired: true,
                reason: "calendar_reconnect_required",
              });
            throw new Error(failure(list, result.status));
          }
          setCalendars(list.calendars);
          setCalendarId((selected) =>
            list.calendars.some((item: Calendar) => item.id === selected)
              ? selected
              : (list.calendars.find((item: Calendar) => item.primary)?.id ??
                list.calendars.find(
                  (item: Calendar) => item.accessRole === "owner",
                )?.id ??
                list.calendars[0]?.id ??
                ""),
          );
        } else {
          setCalendars([]);
          setEventResult(null);
        }
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : "Calendar could not load.");
      } finally {
        if (!abort.signal.aborted) setLoadedRevision(refresh);
      }
    }
    void load();
    return () => abort.abort();
  }, [refresh, read]);
  useEffect(() => {
    if (!status?.connected || status.reconnectRequired || !calendarId) return;
    const abort = new AbortController();
    if (rangeError) return;
    const params = new URLSearchParams({
      action: "events",
      calendarId,
      from: `${from}T00:00:00+05:30`,
      to: `${to}T00:00:00+05:30`,
    });
    read(`/api/calendar?${params}`, {
      signal: abort.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (abort.signal.aborted) return;
        if (!response.ok) {
          if (data.error?.code === "calendar_reconnect_required")
            setStatus({
              configured: true,
              connected: false,
              reconnectRequired: true,
              reason: "calendar_reconnect_required",
            });
          throw new Error(failure(data, response.status));
        }
        setEventResult({
          key: eventKey,
          events: data.events,
          truncated: Boolean(data.truncated),
        });
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setError(e instanceof Error ? e.message : "Could not load events.");
          setEventResult({ key: eventKey, events: [], truncated: false });
        }
      });
    return () => abort.abort();
  }, [
    status?.connected,
    status?.reconnectRequired,
    calendarId,
    from,
    to,
    refresh,
    rangeError,
    eventKey,
    read,
  ]);
  useEffect(() => {
    if (hasDraft)
      formRef.current?.scrollIntoView({
        behavior: "instant",
        block: "nearest",
      });
  }, [hasDraft]);
  async function post(body: unknown, path = "/api/calendar") {
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 45000);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error?.code === "calendar_reconnect_required")
          setStatus({
            configured: true,
            connected: false,
            reconnectRequired: true,
            reason: "calendar_reconnect_required",
          });
        if (data.error?.code === "calendar_proposal_expired") {
          setPreview(null);
          setSaveAttempted(false);
          throw new Error(
            "This preview expired. Check your calendar for an earlier save before preparing a new preview.",
          );
        }
        throw new Error(failure(data, response.status));
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "The request could not finish. Retry the same action to recover its result.",
        );
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function changed() {
    try {
      await onChanged();
    } catch {
      setError(
        "Saved successfully, but the workspace could not refresh. Refresh the page to see the change.",
      );
    }
  }
  function connect() {
    void run(async () => {
      const data = await post({ action: "connect" });
      const url = new URL(data.url);
      if (url.protocol !== "https:" || url.hostname !== "accounts.google.com")
        throw new Error(
          "The calendar connection returned an invalid sign-in address.",
        );
      window.location.assign(url.href);
    });
  }
  function edit(event?: Event) {
    setPreview(null);
    setSaveAttempted(false);
    requestId.current = null;
    setDraft(
      event
        ? {
            calendarId: event.calendarId,
            id: event.id,
            etag: event.etag,
            title: event.title,
            start: localTime(event.start),
            end: localTime(event.end),
            attendees: event.attendees ?? [],
            createMeet: Boolean(event.createMeet || event.joinUrl),
          }
        : blank(calendarId),
    );
    setAttendees(event?.attendees?.join(", ") ?? "");
  }
  function prepare() {
    if (!draft) return;
    void run(async () => {
      const guests = attendees
        .split(/[,;\n]/)
        .map((value) => value.trim())
        .filter(Boolean);
      if (guests.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))
        throw new Error(
          "Enter complete attendee email addresses, separated by commas.",
        );
      if (!draft.title.trim() || !draft.start || !draft.end)
        throw new Error("Add a title, start time, and end time.");
      const start = `${draft.start}:00+05:30`,
        end = `${draft.end}:00+05:30`;
      if (
        !Number.isFinite(Date.parse(start)) ||
        Date.parse(end) <= Date.parse(start)
      )
        throw new Error("The end time must be after the start time.");
      requestId.current ??= crypto.randomUUID();
      const data = await post({
        action: "preview",
        requestId: requestId.current,
        event: {
          ...draft,
          title: draft.title.trim(),
          start,
          end,
          attendees: guests,
        },
      });
      setPreview(data);
      setSaveAttempted(false);
    });
  }
  function save() {
    if (!preview) return;
    void run(async () => {
      setSaveAttempted(true);
      await post({
        action: "apply",
        proposal: preview.proposal,
        confirmed: true,
      });
      setPreview(null);
      setDraft(null);
      setSaveAttempted(false);
      requestId.current = null;
      setNotice("Event saved to Google Calendar.");
      invalidate("/api/calendar?");
      setRefresh((value) => value + 1);
      await changed();
    });
  }
  async function importFile(file?: File) {
    if (!file) return;
    await run(async () => {
      if (file.size > 60000)
        throw new Error("Choose an .ics file smaller than 60 KB.");
      const data = await post({ action: "import", text: await file.text() });
      setImported(data);
    });
  }
  const canWrite = calendars.some(
    (calendar) =>
      calendar.id === calendarId &&
      ["owner", "writer"].includes(calendar.accessRole),
  );
  return (
    <section className={styles.panel} aria-label="Calendar">
      <header className={styles.header}>
        <div>
          <h2>Google Calendar</h2>
          <p>Times shown in Asia/Kolkata.</p>
        </div>
        <div className={styles.actions}>
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => {
              setError("");
              invalidate("/api/calendar?");
              setRefresh((value) => value + 1);
            }}
          >
            Refresh
          </button>
        </div>
      </header>
      {(error || rangeError) && (
        <p className={styles.error} role="alert">
          {error || rangeError}
        </p>
      )}
      {notice && (
        <p className={styles.success} role="status">
          {notice}
        </p>
      )}
      {loading && <p role="status">Loading calendar...</p>}
      {status && (!status.connected || status.reconnectRequired) && (
        <div className={styles.card}>
          <h3>
            {status.reconnectRequired
              ? "Reconnect Google Calendar"
              : "Connect Google Calendar"}
          </h3>
          <p className={styles.hint}>
            {(status.reason
              ? failure({ error: status.reason }, 503)
              : undefined) ??
              (status.configured
                ? "See your upcoming events and create meetings here. Google will ask you to approve calendar access."
                : "Google Calendar is not configured for this workspace yet. You can still import an .ics calendar below.")}
          </p>
          {status.configured && (
            <button className="primary" disabled={busy} onClick={connect}>
              {busy
                ? "Connecting..."
                : status.reconnectRequired
                  ? "Reconnect calendar"
                  : "Connect Google Calendar"}
            </button>
          )}
        </div>
      )}
      {status?.connected && !status.reconnectRequired && (
        <>
          <div className={styles.card}>
            <div className={styles.filters}>
              <label>
                Calendar
                <select
                  disabled={busy || saveAttempted || !calendars.length}
                  value={calendarId}
                  onChange={(event) => {
                    setCalendarId(event.target.value);
                    setDraft(null);
                    setPreview(null);
                  }}
                >
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                From
                <input
                  type="date"
                  value={from}
                  onInput={(event) => setFrom(event.currentTarget.value)}
                />
              </label>
              <label>
                Until (exclusive)
                <input
                  type="date"
                  value={to}
                  onInput={(event) => setTo(event.currentTarget.value)}
                />
              </label>
              <button
                className="primary"
                disabled={busy || !!preview || !canWrite}
                onClick={() => edit()}
              >
                New event
              </button>
            </div>
            {eventsLoading ? (
              <p role="status">Loading events...</p>
            ) : !events.length ? (
              <p className={styles.hint}>
                {error
                  ? "Events could not be loaded. Refresh after resolving the error."
                  : "No events in this date range."}
              </p>
            ) : (
              <ul className={styles.agenda}>
                {events.map((event) => (
                  <li
                    key={`${event.calendarId}-${event.id}`}
                    className={styles.event}
                  >
                    <div className={styles.date} aria-hidden="true">
                      {new Date(event.start).toLocaleString("en-IN", {
                        month: "short",
                        timeZone: "Asia/Kolkata",
                      })}
                      <b>
                        {new Date(event.start).toLocaleString("en-IN", {
                          day: "numeric",
                          timeZone: "Asia/Kolkata",
                        })}
                      </b>
                    </div>
                    <div className={styles.eventBody}>
                      <h4>{event.title}</h4>
                      <p>
                        {event.allDay
                          ? `All day / ${event.start.slice(0, 10)} to ${event.end.slice(0, 10)} (end exclusive)`
                          : `${displayTime(event.start)} to ${displayTime(event.end)}`}
                      </p>
                      <div className={styles.actions}>
                        {link(event.joinUrl) && (
                          <a
                            href={link(event.joinUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Join meeting
                          </a>
                        )}
                        {link(event.htmlLink) && (
                          <a
                            href={link(event.htmlLink)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open in Google Calendar
                          </a>
                        )}
                        {canWrite &&
                          !event.allDay &&
                          !event.recurringEventId &&
                          !event.originalStartTime && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => edit(event)}
                            >
                              Edit event
                            </button>
                          )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {truncated && (
              <p className={styles.notice}>
                There are more events in this range. Choose fewer days to see
                them all.
              </p>
            )}
          </div>
          {draft && (
            <div className={styles.card} ref={formRef}>
              <h3>{draft.id ? "Edit event" : "New event"}</h3>
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  prepare();
                }}
              >
                <fieldset disabled={busy || !!preview}>
                  <label>
                    Title
                    <input
                      required
                      maxLength={200}
                      value={draft.title}
                      onChange={(event) => {
                        requestId.current = null;
                        setDraft({ ...draft, title: event.target.value });
                      }}
                    />
                  </label>
                  <div className={styles.grid}>
                    <label>
                      Starts (IST)
                      <input
                        required
                        type="datetime-local"
                        value={draft.start}
                        onInput={(event) => {
                          const value = event.currentTarget.value;
                          requestId.current = null;
                          setDraft((current) =>
                            current ? { ...current, start: value } : current,
                          );
                        }}
                      />
                    </label>
                    <label>
                      Ends (IST)
                      <input
                        required
                        type="datetime-local"
                        value={draft.end}
                        onInput={(event) => {
                          const value = event.currentTarget.value;
                          requestId.current = null;
                          setDraft((current) =>
                            current ? { ...current, end: value } : current,
                          );
                        }}
                      />
                    </label>
                  </div>
                  <label>
                    Attendee emails
                    <input
                      type="text"
                      placeholder="alex@example.com, sam@example.com"
                      value={attendees}
                      maxLength={2000}
                      onChange={(event) => {
                        requestId.current = null;
                        setAttendees(event.target.value);
                      }}
                    />
                  </label>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={draft.createMeet}
                      disabled={Boolean(
                        draft.id &&
                          events.find((item) => item.id === draft.id)?.joinUrl,
                      )}
                      onChange={(event) => {
                        requestId.current = null;
                        setDraft({
                          ...draft,
                          createMeet: event.target.checked,
                        });
                      }}
                    />
                    Add a Google Meet link (existing links are kept)
                  </label>
                </fieldset>
                {!preview && (
                  <div className={styles.actions}>
                    <button className="primary" disabled={busy} type="submit">
                      {busy ? "Preparing..." : "Review event"}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      type="button"
                      onClick={() => setDraft(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </form>
              {preview && (
                <div className={styles.preview}>
                  <h4>Confirm event</h4>
                  <dl>
                    <dt>Calendar</dt>
                    <dd>
                      {calendars.find(
                        (item) => item.id === preview.event.calendarId,
                      )?.title ?? preview.event.calendarId}
                    </dd>
                    <dt>Title</dt>
                    <dd>{preview.event.title}</dd>
                    <dt>Starts</dt>
                    <dd>{displayTime(preview.event.start)}</dd>
                    <dt>Ends</dt>
                    <dd>{displayTime(preview.event.end)}</dd>
                    <dt>Attendees</dt>
                    <dd>{preview.event.attendees?.join(", ") || "Only you"}</dd>
                    <dt>Google Meet</dt>
                    <dd>{preview.event.createMeet ? "Yes" : "No"}</dd>
                  </dl>
                  <p className={styles.hint}>
                    Saving updates Google Calendar and sends invitations or
                    updates to the listed attendees.
                  </p>
                  <div className={styles.actions}>
                    <button className="primary" disabled={busy} onClick={save}>
                      {busy
                        ? "Saving..."
                        : saveAttempted
                          ? "Retry same save"
                          : "Confirm and save"}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || saveAttempted}
                      onClick={() => {
                        setPreview(null);
                        requestId.current = null;
                      }}
                    >
                      Back to edit
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className={styles.actions}>
            {disconnectConfirm ? (
              <>
                <span className={styles.hint}>
                  Remove Workspace access to your calendar?
                </span>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await post({ action: "disconnect" });
                      setDisconnectConfirm(false);
                      setDraft(null);
                      setPreview(null);
                      setNotice(
                        "Calendar disconnected. Your Google events are unchanged.",
                      );
                      invalidate("/api/calendar?");
                      setRefresh((value) => value + 1);
                    })
                  }
                >
                  Confirm disconnect
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => setDisconnectConfirm(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="text-button"
                disabled={busy || saveAttempted}
                onClick={() => setDisconnectConfirm(true)}
              >
                Disconnect Google Calendar
              </button>
            )}
          </div>
        </>
      )}
      <details className={`${styles.card} ${styles.import}`}>
        <summary>Import a calendar file</summary>
        <p className={styles.hint}>
          Import an .ics file as workspace meetings. This is a one-time copy; it
          does not send invitations or sync with Google.
        </p>
        <label>
          Calendar file (.ics, up to 60 KB)
          <input
            type="file"
            accept=".ics,text/calendar"
            disabled={busy}
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        {imported && (
          <div className={styles.preview}>
            <h4>
              {imported.receipt
                ? imported.receipt.undo
                  ? "Import undone"
                  : "Meetings imported"
                : "Review imported meetings"}
            </h4>
            {imported.warnings?.length > 0 && (
              <ul>
                {imported.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            )}
            <ul>
              {imported.proposal.operations.map((operation) => (
                <li key={operation.id}>
                  <strong>{String(operation.data.title)}</strong>
                  <br />
                  {displayTime(String(operation.data.start))} to{" "}
                  {displayTime(String(operation.data.end))}
                </li>
              ))}
            </ul>
            {!imported.receipt ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const data = await post(
                      { action: "apply", proposal: imported.proposal },
                      "/api/commands",
                    );
                    setImported({ ...imported, receipt: data.receipt });
                    setNotice("Meetings imported into your workspace.");
                    await changed();
                  })
                }
              >
                Import {imported.proposal.operations.length} meetings
              </button>
            ) : (
              !imported.receipt.undo && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const data = await post(
                        {
                          action: "undo",
                          commandId: imported.receipt?.commandId,
                        },
                        "/api/commands",
                      );
                      setImported({ ...imported, receipt: data.receipt });
                      await changed();
                    })
                  }
                >
                  Undo import
                </button>
              )
            )}
          </div>
        )}
      </details>
    </section>
  );
}
