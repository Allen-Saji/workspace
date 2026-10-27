export function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    focus: (<><circle cx="12" cy="14" r="8" /><path d="M9 2h6M12 2v4m6 1 2-2m-8 6v4l3 2" /></>),
    today: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    calendar: (<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 2v6m10-6v6M3 11h18M7 15h3m4 0h3" /></>),
    learning: (
      <>
        <path d="M12 5v16M12 5C8 2 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-2-1-6-2-10 1Z" />
      </>
    ),
    agents: (
      <>
        <rect x="3" y="6" width="18" height="15" rx="5" />
        <path d="M12 2v4M1 12v4m22-4v4M8 12v2m8-2v2m-7 3h6" />
      </>
    ),
    context: (
      <>
        <path d="M5 2h10l4 4v16H5zM14 2v5h5M8 12h8M8 16h6" />
      </>
    ),
    note: (
      <>
        <path d="m4 16-1 5 5-1L21 7l-4-4ZM14 6l4 4" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.note}
    </svg>
  );
}
