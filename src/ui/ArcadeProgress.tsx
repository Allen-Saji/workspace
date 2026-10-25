export default function ArcadeProgress({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  if (max <= 0) return null;
  const amount = Math.min(max, Math.max(0, value));
  return (
    <span
      className="arcade-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={amount}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} aria-hidden="true">
          <i
            style={{
              width: `${Math.min(1, Math.max(0, (amount / max) * 5 - index)) * 100}%`,
            }}
          />
        </span>
      ))}
    </span>
  );
}
