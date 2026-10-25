"use client";
import { useEffect, useState, useRef } from "react";
import type { WorkspaceRecord } from "../domain/contracts";
import type { Proposal, CommandReceipt, Operation } from "../domain/commands";

import { validateProposal } from "../domain/commands";
import { Modal } from "./primitives";

type Draft = {
  text: string;
  proposal: Proposal | null;
  receipt: CommandReceipt | null;
  attempted: boolean;
  requestId?: string;
  source?: string;
};
function load(key: string): Draft {
  try {
    const s = sessionStorage.getItem(key);
    if (s) return JSON.parse(s);
  } catch {}
  return { text: "", proposal: null, receipt: null, attempted: false };
}
export default function CommandReview({
  workspaceId,
  records,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  records: WorkspaceRecord[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const interpreting = useRef(false);
  const key = "workspace-command-draft-v2-" + workspaceId;
  const [draft, setDraft] = useState<Draft>(() => load(key)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* Server receipts remain authoritative if browser storage is unavailable. */
    }
  }, [draft, key]);
  async function review() {
    if (interpreting.current || busy) return;
    interpreting.current = true;
    setBusy(true);
    setError("");
    const requestId = draft.requestId ?? crypto.randomUUID();
    setDraft((d) => ({ ...d, requestId }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/interpret", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Request": "local-ui",
        },
        body: JSON.stringify({
          requestId,
          text: draft.text,
          mode: "formats",
          timezone: "Asia/Kolkata",
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          "Unable to prepare a proposal. Your draft is preserved; nothing was applied.",
        );
      if (!result.proposal) {
        setError(result.clarification ?? "Please clarify the draft.");
        return;
      }
      setDraft((d) => ({
        ...d,
        proposal: result.proposal,
        source: result.source,
      }));
    } catch {
      setError(
        "Interpretation is unavailable. Your draft is preserved; retry when connected. No records were changed.",
      );
    } finally {
      clearTimeout(timer);
      interpreting.current = false;
      setBusy(false);
    }
  }
  async function importProposal(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 32768) throw new Error("too_large");
      const saved = JSON.parse(await file.text());
      const proposal = validateProposal(saved.result?.proposal);
      if (saved.result?.source !== "ai" || saved.applied !== false)
        throw new Error("invalid_saved_proposal");
      setDraft((d) => ({
        ...d,
        proposal,
        source: "saved-ai",
        attempted: false,
        receipt: null,
      }));
      setError("");
    } catch {
      setError(
        "Unable to review this saved proposal. Use an unapplied AI result export; nothing was changed.",
      );
    }
  }
  function edit(index: number, change: Partial<Operation>) {
    setDraft((d) => ({
      ...d,
      proposal: {
        ...d.proposal!,
        operations: d.proposal!.operations.map((op, i) =>
          i === index ? { ...op, ...change } : op,
        ),
      },
    }));
  }
  function target(index: number, id: string) {
    const op = draft.proposal!.operations[index],
      record = records.find((r) => r.id === id);
    if (!record) {
      edit(index, { id: crypto.randomUUID(), expectedRevision: 0 });
      return;
    }
    const names =
      op.kind === "task"
        ? ["title", "status", "dueDate"]
        : op.kind === "meeting"
          ? ["title", "start", "end"]
          : ["title", "content"];
    edit(index, {
      id: record.id,
      expectedRevision: record.revision,
      data: Object.fromEntries(names.map((k) => [k, record.data[k]])),
    });
  }
  async function action(action: "apply" | "undo" | "receipt") {
    if (busy || !draft.proposal) return;
    setBusy(true);
    setError("");
    setDraft((d) => ({ ...d, attempted: true }));
    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Request": "local-ui",
        },
        body: JSON.stringify({
          action,
          ...(action === "apply"
            ? { proposal: draft.proposal }
            : { commandId: draft.proposal.commandId }),
        }),
      });
      const result = await response.json();
      if (action === "receipt" && response.status === 404) {
        setDraft((d) => ({ ...d, attempted: false }));
        setError(
          "No committed receipt found. You can edit or retry this proposal.",
        );
        return;
      }
      if (!response.ok) {
        if (response.status < 500)
          setDraft((d) => ({ ...d, attempted: false }));
        throw new Error(
          result.error?.code === "revision_conflict"
            ? "A record changed. Refresh and review its latest revision; nothing was changed by this request."
            : `Request declined: ${result.error?.code ?? response.status}. Your draft is preserved.`,
        );
      }
      setDraft((d) => ({ ...d, receipt: result.receipt }));
      await onChanged();
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Connection lost: outcome unknown. Check the receipt before retrying."
          : e instanceof Error
            ? e.message
            : "Unable to complete request.",
      );
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || draft.attempted || !!draft.receipt;
  const fieldLabels: Record<string, string> = {
    title: "Title",
    content: "Note",
    status: "Status",
    dueDate: "Due date",
    start: "Starts (with timezone)",
    end: "Ends (with timezone)",
  };
  return (
    <Modal
      title="Plan from text"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="editor">
        {!draft.proposal ? (
          <>
            <p>Use one action per line, then review before saving.</p>
            <label>
              Your draft
              <textarea
                disabled={busy}
                value={draft.text}
                maxLength={12000}
                rows={5}
                placeholder="task: Buy milk"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, text: e.target.value }))
                }
              />
            </label>
            <details>
              <summary>Examples and supported formats</summary>
              <pre>
                task: Buy milk{"\n"}note: Weekend | Visit the library{"\n"}
                meeting: Practice | 2026-10-25 09:00 | 2026-10-25 09:30
              </pre>
              <p className="muted small">
                Meetings use 24-hour time in Asia/Kolkata (IST). Use exact
                dates. AI interpretation is not connected.
              </p>
            </details>
            <details>
              <summary>Import a saved AI proposal</summary>
              <label>
                Proposal file
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={(e) => void importProposal(e.target.files?.[0])}
                />
              </label>
              <p className="muted small">
                Import an unapplied result, then review every field. No model is
                called.
              </p>
            </details>
            <button
              className="primary"
              disabled={busy || !draft.text.trim()}
              onClick={() => void review()}
            >
              {busy ? "Preparing..." : "Review proposal"}
            </button>
          </>
        ) : (
          <>
            <p>
              {draft.source === "saved-ai" || draft.source === "ai"
                ? "Review the AI proposal carefully. "
                : "Review each action. "}
              Nothing changes until you save.
            </p>
            {draft.proposal.operations.map((op, i) => (
              <fieldset key={i} disabled={locked}>
                <legend>
                  {i + 1}.{" "}
                  {op.kind === "task"
                    ? "Task"
                    : op.kind === "meeting"
                      ? "Meeting"
                      : "Note"}
                </legend>
                <label>
                  Save to
                  <select
                    value={op.expectedRevision ? op.id : ""}
                    onChange={(e) => target(i, e.target.value)}
                  >
                    <option value="">New {op.kind}</option>
                    {records
                      .filter((r) => r.kind === op.kind)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {String(r.data.title)} (v{r.revision},{" "}
                          {r.id.slice(0, 8)})
                        </option>
                      ))}
                  </select>
                </label>
                {Object.entries(op.data).map(([name, value]) => (
                  <label key={name}>
                    {fieldLabels[name] ?? name}
                    {name === "status" ? (
                      <select
                        value={String(value ?? "")}
                        onChange={(e) =>
                          edit(i, {
                            data: { ...op.data, [name]: e.target.value },
                          })
                        }
                      >
                        <option value="ready">Ready</option>
                        <option value="in_progress">In progress</option>
                        <option value="done">Done</option>
                      </select>
                    ) : name === "content" ? (
                      <textarea
                        value={String(value ?? "")}
                        onChange={(e) =>
                          edit(i, {
                            data: { ...op.data, [name]: e.target.value },
                          })
                        }
                      />
                    ) : (
                      <input
                        type={name === "dueDate" ? "date" : "text"}
                        value={String(value ?? "")}
                        onInput={
                          name === "dueDate"
                            ? (e) =>
                                edit(i, {
                                  data: {
                                    ...op.data,
                                    [name]: e.currentTarget.value,
                                  },
                                })
                            : undefined
                        }
                        onChange={(e) =>
                          edit(i, {
                            data: { ...op.data, [name]: e.target.value },
                          })
                        }
                      />
                    )}
                  </label>
                ))}
                {op.kind === "meeting" ? (
                  <p className="muted small">
                    {["start", "end"]
                      .map((k) => {
                        const n = Date.parse(String(op.data[k]));
                        return Number.isFinite(n)
                          ? new Date(n).toLocaleString("en-IN", {
                              timeZone: "Asia/Kolkata",
                            })
                          : "Invalid time";
                      })
                      .join(" to ")}{" "}
                    IST
                  </p>
                ) : null}
              </fieldset>
            ))}
            {!draft.receipt ? (
              <div className="form-actions">
                <button
                  className="secondary"
                  disabled={locked}
                  onClick={() => {
                    setDraft((d) => ({ ...d, proposal: null }));
                    setError("");
                  }}
                >
                  Back
                </button>
                {draft.attempted ? (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void action("receipt")}
                  >
                    Check save status
                  </button>
                ) : null}
                <button
                  className="primary"
                  disabled={busy || draft.attempted}
                  onClick={() => void action("apply")}
                >
                  Save {draft.proposal.operations.length}{" "}
                  {draft.proposal.operations.length === 1
                    ? "action"
                    : "actions"}
                </button>
              </div>
            ) : (
              <div role="status" className="callout">
                <strong>
                  {draft.receipt.undo ? "Changes undone" : "Changes saved"}
                </strong>
                <p>{draft.receipt.changes.length} records</p>
                {!draft.receipt.undo ? (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void action("undo")}
                  >
                    Undo changes
                  </button>
                ) : null}
              </div>
            )}
            <details>
              <summary>Command details</summary>
              <p className="muted small">Command: {draft.proposal.commandId}</p>
              {draft.receipt ? (
                <p className="muted small">
                  Receipt:{" "}
                  {draft.receipt.undo?.receiptId ?? draft.receipt.receiptId}
                </p>
              ) : null}
              <p className="muted small">
                Undo is available for seven days, unless a record has changed
                since this command.
              </p>
            </details>
          </>
        )}
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <button
            className="text-button"
            disabled={busy || (draft.attempted && !draft.receipt)}
            onClick={() => {
              sessionStorage.removeItem(key);
              setDraft({
                text: "",
                proposal: null,
                receipt: null,
                attempted: false,
              });
              setError("");
            }}
          >
            Clear draft
          </button>
          <button className="secondary" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted small">
          Your draft stays in this tab until cleared or the tab closes.
        </p>
      </div>
    </Modal>
  );
}
