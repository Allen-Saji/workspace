"use client";
import { useState } from "react";
import type { RecordKind, WorkspaceRecord } from "../domain/contracts";
import { Modal, readable } from "./primitives";
export type EditTarget = { kind: RecordKind; record?: WorkspaceRecord };
export default function Editor({
  target,
  onClose,
  onSave,
}: {
  target: EditTarget;
  onClose: () => void;
  onSave: (command: unknown) => Promise<void>;
}) {
  const { kind, record } = target,
    d = record?.data ?? {};
  const [id] = useState(() => record?.id ?? crypto.randomUUID());
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(readable(d.status) || "not_started");
  const titles = {
    task: "task",
    lesson: "learning step",
    capture: "captured context",
    registration: "test connection",
    note: "note",
    meeting: "meeting",
  };
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget),
      get = (name: string) => String(form.get(name) ?? "");
    try {
      let data: Record<string, unknown>;
      if (kind === "task")
        data = {
          title: get("title"),
          status: get("status"),
          dueDate: get("dueDate"),
        };
      else if (kind === "lesson")
        data = {
          title: get("title"),
          status: get("status"),
          evidence: get("evidence"),
        };
      else if (kind === "capture") {
        const disposition = get("disposition");
        data = {
          content: get("content"),
          disposition,
          userAccepted: disposition === "accepted",
        };
      } else if (kind === "meeting")
        data = {
          title: get("title"),
          start: new Date(get("start")).toISOString(),
          end: new Date(get("end")).toISOString(),
        };
      else if (kind === "registration")
        data = {
          displayName: get("displayName"),
          status: "pending",
          requestedScopes: ["reports:append", "captures:append"],
        };
      else data = { title: get("title"), content: get("content") };
      await onSave({ id, kind, expectedRevision: record?.revision ?? 0, data });
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to save. Your draft is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  function localInput(value: unknown) {
    const s = readable(value);
    if (!s) return "";
    const date = new Date(s);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
  return (
    <Modal
      title={`${record ? "Edit" : "Add"} ${titles[kind]}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="editor">
        {kind === "registration" ? (
          <>
            <p className="callout">
              Local permission-flow rehearsal. Identity is unverified. Approval
              creates no credentials and grants no access to personal context.
            </p>
            <label>
              Agent display name
              <input name="displayName" required maxLength={100} autoFocus />
            </label>
            <p>Requested scopes: append reports and captures only.</p>
          </>
        ) : null}
        {!["capture", "registration"].includes(kind) ? (
          <label>
            {kind === "lesson" ? "Learning objective" : "Title"}
            <input
              name="title"
              defaultValue={readable(d.title)}
              required
              maxLength={200}
              autoFocus
            />
          </label>
        ) : null}
        {kind === "task" ? (
          <div className="form-row">
            <label>
              Status
              <select
                name="status"
                defaultValue={readable(d.status) || "ready"}
              >
                <option value="ready">Ready</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </label>
            <label>
              Due date (optional)
              <input
                name="dueDate"
                type="date"
                defaultValue={readable(d.dueDate)}
              />
            </label>
          </div>
        ) : null}
        {kind === "lesson" ? (
          <>
            <label>
              Progress
              <select
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <label>
              Practice or evidence note
              <textarea
                name="evidence"
                defaultValue={readable(d.evidence)}
                required={status === "completed"}
                maxLength={1000}
                placeholder="What did you practice or complete?"
              />
            </label>
          </>
        ) : null}
        {kind === "meeting" ? (
          <>
            <div className="form-row">
              <label>
                Starts
                <input
                  name="start"
                  type="datetime-local"
                  required
                  defaultValue={localInput(d.start)}
                />
              </label>
              <label>
                Ends
                <input
                  name="end"
                  type="datetime-local"
                  required
                  defaultValue={localInput(d.end)}
                />
              </label>
            </div>
            <p className="muted">
              Times use your browser&apos;s timezone. Calendar sync is not
              connected.
            </p>
          </>
        ) : null}
        {kind === "capture" || kind === "note" ? (
          <label>
            {kind === "capture" ? "Workspace wording" : "Your note"}
            <textarea
              name="content"
              required
              maxLength={kind === "note" ? 4000 : 2000}
              defaultValue={readable(d.content)}
              autoFocus={kind === "capture"}
            />
          </label>
        ) : null}
        {kind === "capture" ? (
          <>
            <label>
              Your decision
              <select
                name="disposition"
                defaultValue={
                  d.userAccepted
                    ? "accepted"
                    : readable(d.disposition) === "owner_approved"
                      ? "proposed"
                      : readable(d.disposition) || "proposed"
                }
              >
                <option value="proposed">Not accepted yet</option>
                <option value="accepted">Accept in workspace</option>
                <option value="rejected">Reject in workspace</option>
                <option value="archived">Archive in workspace</option>
              </select>
            </label>
            <p className="callout">
              Changes stay in Workspace. The original report is preserved;
              corrections are not sent to the assistant.
            </p>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        <footer className="form-actions">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? "Saving..."
              : kind === "registration"
                ? "Create test request"
                : record
                  ? "Save changes"
                  : "Add " + titles[kind]}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
