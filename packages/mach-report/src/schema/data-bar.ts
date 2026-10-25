import type { GridCell } from "./render-plan";
export function validDataBar(value: unknown): value is NonNullable<GridCell["dataBar"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { start, end, color } = value as Partial<NonNullable<GridCell["dataBar"]>>;
  return typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 1 && start <= end && typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
}
