import { validDataBar } from "../schema/data-bar";
import type { GridCell } from "../schema/render-plan";
export interface DataBarBox { x: number; y: number; width: number; height: number; color: string }
/** Same inset and normalized geometry for DOM, Canvas and PDF; units come from the caller. */
export function dataBarBox(bar: GridCell["dataBar"], width: number, height: number, inset: number): DataBarBox | undefined {
  if (!validDataBar(bar) || bar.start === bar.end) return undefined;
  const inner = Math.max(0, width - 2 * inset);
  return { x: inset + inner * bar.start, y: inset, width: inner * (bar.end - bar.start), height: Math.max(0, height - 2 * inset), color: bar.color };
}
