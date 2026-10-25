"use client";
import { useEffect, useState } from "react";
import type { CommandReceipt } from "../domain/commands";
import { Modal } from "./primitives";
export default function CommandHistory({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState<CommandReceipt[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  async function refresh() {
    setError("");
    try {
      const r = await fetch("/api/commands", { cache: "no-store" });
      if (!r.ok) throw new Error("History unavailable. Sign in or retry.");
      setRows((await r.json()).commands);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/commands", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("History unavailable. Sign in or retry.");
        setRows((await r.json()).commands);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function undo(id: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Request": "local-ui",
        },
        body: JSON.stringify({ action: "undo", commandId: id }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.code === "revision_conflict"
            ? "A record changed after this command. Nothing was undone."
            : result.error?.code === "undo_expired"
              ? "The seven-day undo window has ended."
              : "Undo could not be confirmed. Refresh history before retrying.",
        );
      setSelected(null);
      await refresh();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Command history"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="editor">
        <p>
          Recent saved commands. Undo is available for seven days and preserves
          later edits.
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh history
        </button>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        {!rows ? (
          <p>Loading receipts...</p>
        ) : rows.length === 0 ? (
          <p>No saved commands yet.</p>
        ) : (
          rows.map((r) => (
            <section className="callout" key={r.commandId}>
              <h3>
                {r.undo ? "Undone" : "Saved"} / {r.changes.length} actions
              </h3>
              <p>
                {new Date(r.committedAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}{" "}
                IST
              </p>
              <ul>
                {r.changes.map((c) => (
                  <li key={c.after.id}>
                    {c.before ? "Updated" : "Created"} {c.after.kind}:{" "}
                    {String(c.after.data.title)}
                  </li>
                ))}
              </ul>
              <details>
                <summary>Receipt and changes</summary>
                <p>Command {r.commandId}</p>
                <p>Receipt {r.undo?.receiptId ?? r.receiptId}</p>
                {r.changes.map((c) => (
                  <div key={c.after.id}>
                    <strong>{c.after.kind}</strong>
                    <pre>
                      {JSON.stringify(
                        { before: c.before?.data ?? null, after: c.after.data },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                ))}
              </details>
              {!r.undo ? (
                selected === r.commandId ? (
                  <div className="undo-confirmation">
                    <p>Undo all {r.changes.length} actions?</p>
                    <div className="form-actions">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void undo(r.commandId)}
                      >
                        Confirm undo
                      </button>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => setSelected(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setSelected(r.commandId)}
                  >
                    Review undo
                  </button>
                )
              ) : (
                <p>
                  Undo saved:{" "}
                  {new Date(r.undo.committedAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  IST
                </p>
              )}
            </section>
          ))
        )}
      </div>
    </Modal>
  );
}
