export default function FocusTimerIcon({
  kind,
}: {
  kind: "timer" | "play" | "pause" | "reset" | "expand" | "collapse" | "check";
}) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "timer" ? (
        <>
          <circle cx="12" cy="14" r="8" />
          <path d="M9 2h6M12 6V2m6 5 2-2m-8 6v4l3 2" />
        </>
      ) : kind === "play" ? (
        <path d="m9 5 11 7-11 7z" />
      ) : kind === "pause" ? (
        <path d="M8 5v14M16 5v14" />
      ) : kind === "reset" ? (
        <>
          <path d="M3 10a9 9 0 1 1 1 9M3 4v6h6" />
        </>
      ) : kind === "expand" ? (
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
      ) : kind === "collapse" ? (
        <path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5" />
      ) : (
        <path d="m5 12 4 4L19 6" />
      )}
    </svg>
  );
}
