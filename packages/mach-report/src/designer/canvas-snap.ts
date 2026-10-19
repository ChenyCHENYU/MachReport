import type { TemplateComponent } from "@agile-team/mach-report";
import { componentHeight } from "./canvas-commands";
export function canvasSnapMarks(
  components: TemplateComponent[],
  current: TemplateComponent,
  axis: "leftMm" | "topMm",
): number[] {
  const values = components
    .filter((component) => component !== current)
    .flatMap((component) => {
      const start = component[axis],
        size =
          axis === "leftMm" ? component.widthMm : componentHeight(component);
      return [start, start + size / 2, start + size];
    });
  return [...new Set(values)].sort((first, second) => first - second);
}
function nearest(values: number[], value: number): number | undefined {
  if (!values.length) return;
  let low = 0,
    high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid]! < value) low = mid + 1;
    else high = mid;
  }
  const before = values[Math.max(0, low - 1)]!,
    after = values[Math.min(values.length - 1, low)]!;
  return Math.abs(before - value) < Math.abs(after - value) ? before : after;
}
/** 每轴三次二分查找；组件多时仍不在每次移动扫描整页。 */
export function snapCanvasAxis(
  value: number,
  size: number,
  marks: number[],
  tolerance: number,
): { value: number; guide?: number } {
  let difference = Infinity,
    result: { value: number; guide?: number } = {
      value: Math.round(value * 2) / 2,
    };
  for (const offset of [0, size / 2, size]) {
    const mark = nearest(marks, value + offset);
    if (mark === undefined) continue;
    const distance = Math.abs(mark - value - offset);
    if (distance <= tolerance && distance < difference) {
      difference = distance;
      result = { value: mark - offset, guide: mark };
    }
  }
  return result;
}
