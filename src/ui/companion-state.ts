export type PetPosition = { x: number; y: number };
export type PetPreferences = {
  visibility: "shown" | "minimized" | "hidden";
  paused: boolean;
  position: PetPosition;
};
export type PetReaction = { id: number; kind: "celebrate" | "saved" };
export const defaultPreferences: PetPreferences = {
  visibility: "shown",
  paused: false,
  position: { x: 0, y: 1 },
};
const unit = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
export function readPetPreferences(
  raw: string,
  compact = false,
): PetPreferences {
  const fallback: PetPreferences = {
    ...defaultPreferences,
    visibility: compact ? "minimized" : "shown",
  };
  try {
    const value = JSON.parse(raw);
    return {
      visibility: ["shown", "minimized", "hidden"].includes(value?.visibility)
        ? value.visibility
        : fallback.visibility,
      paused: value?.paused === true,
      position: {
        x: unit(value?.position?.x, 0),
        y: unit(value?.position?.y, 1),
      },
    };
  } catch {
    return fallback;
  }
}
export function petBounds(
  viewport: { width: number; height: number },
  minimized: boolean,
) {
  return {
    x: Math.max(0, viewport.width - (minimized ? 48 : 152) - 24),
    y: Math.max(0, viewport.height - (minimized ? 48 : 244) - 24),
  };
}
export function movePet(
  position: PetPosition,
  dx: number,
  dy: number,
  bounds: PetPosition,
): PetPosition {
  return {
    x: unit(position.x + (bounds.x ? dx / bounds.x : 0), 1),
    y: unit(position.y + (bounds.y ? dy / bounds.y : 0), 1),
  };
}
// Called only after the write endpoint confirms success. Refreshes and failed writes never celebrate.
export function reactionForSave(
  command: unknown,
  prior: { data: Record<string, unknown> } | undefined,
): PetReaction["kind"] {
  const value = command as { kind?: string; data?: { status?: string } } | null;
  const complete =
    value?.kind === "task"
      ? "done"
      : value?.kind === "lesson"
        ? "completed"
        : null;
  return complete &&
    value?.data?.status === complete &&
    prior?.data.status !== complete
    ? "celebrate"
    : "saved";
}
