import type { PlanComponent, RenderPlan } from "../schema/render-plan";

/** Independent physical test page. Its ruler is measured in millimetres, never CSS pixels. */
export function createPrintCalibrationPlan(widthMm: number, heightMm: number): RenderPlan {
  if (![widthMm, heightMm].every(value => Number.isFinite(value) && value >= 25 && value <= 600)) throw new RangeError("Calibration paper must be between 25 and 600 mm");
  const components: PlanComponent[] = [];
  const x = Math.min(10, widthMm / 5), y = Math.min(10, heightMm / 5);
  const length = Math.min(50, widthMm - x * 2, heightMm - y * 2);
  components.push({ kind: "rect", leftMm: x, topMm: y, widthMm: length, heightMm: length, style: { borderColor: "#255c8c", lineWidthPt: .5 } });
  for (let tick = 0; tick <= length; tick += 5) {
    components.push({ kind: "line", leftMm: x + tick, topMm: y, widthMm: 0, heightMm: tick % 10 ? 2 : 3, style: { lineColor: "#255c8c", lineWidthPt: .5 } });
    components.push({ kind: "line", leftMm: x, topMm: y + tick, widthMm: tick % 10 ? 2 : 3, heightMm: 0, style: { lineColor: "#255c8c", lineWidthPt: .5 } });
  }
  components.push({ kind: "text", text: `${length} x ${length} mm`, leftMm: x + 4, topMm: y + length / 2 - 2, widthMm: length - 8, heightMm: 4, style: { fontSize: 7, align: "center", color: "#255c8c" } });
  return { schemaVersion: "print-calibration", pages: [{ pageWidthMm: widthMm, pageHeightMm: heightMm, components }] };
}
