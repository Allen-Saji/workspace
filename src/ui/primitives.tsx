import Image from "next/image";
import { useEffect, useId, useRef } from "react";
export function Illustration({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <Image
      className={`illustration ${className}`}
      src={`/illustrations/${name}.png`}
      width={240}
      height={200}
      alt=""
      unoptimized
    />
  );
}
export { Icon } from "./Icon";
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby={titleId}
    >
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
            <path
              d="m5 5 10 10M15 5 5 15"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function readable(value: unknown) {
  return typeof value === "string" ? value : "";
}
export function stamp(value: unknown) {
  const s = readable(value);
  return s
    ? new Date(s).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not reported";
}

export function scopeLabel(scope: string) {
  const labels: Record<string, string> = {
    "reports:append": "Send reports",
    "captures:append": "Send captures",
    "receipts:read": "Read own receipts",
  };
  return labels[scope] ?? scope;
}
