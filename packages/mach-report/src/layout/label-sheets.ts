import type { PlanComponent, PlanPage, RenderPlan } from "../schema/render-plan";
import { snapshotReportJson } from "../schema/json-snapshot";
import { validateRenderPlan } from "../schema/validate";

export interface LabelSheetOptions {
  /** A4 defaults to 210 × 297 mm; custom sizes are explicit physical millimetres. */
  paper?: "a4" | { widthMm: number; heightMm: number };
  columns: number;
  rows: number;
  marginMm?: number | { top: number; left: number; bottom: number; right: number };
  gapMm?: number | { horizontal: number; vertical: number };
  /** Empty slots on the first sheet only (zero based, row-major). */
  startSlot?: number;
  /** Printer calibration; geometry outside the physical sheet is rejected. */
  offsetMm?: { x: number; y: number };
  maxSheets?: number;
  maxComponents?: number;
  /** Independent plain JSON snapshot budget, default 64 MB. */
  maxSnapshotBytes?: number;
  signal?: AbortSignal;
}
export class LabelSheetError extends Error {
  readonly code = "label-sheet";
  constructor(message: string, readonly path: string) { super(message); this.name = "LabelSheetError"; }
}
function active(signal?: AbortSignal): void {
  if (signal?.aborted) { const error = new Error("标签拼版已取消"); error.name = "AbortError"; throw error; }
}
function positive(value: number, path: string, integer = false): number {
  if (!Number.isFinite(value) || value <= 0 || integer && !Number.isSafeInteger(value)) throw new LabelSheetError("应为正有限数字，数量应为安全整数", path);
  return value;
}
function nonnegative(value: number, path: string): number {
  if (!Number.isFinite(value) || value < 0) throw new LabelSheetError("应为非负有限数字", path);
  return value;
}
function spacing(options: LabelSheetOptions) {
  const margin = typeof options.marginMm === "object" ? options.marginMm : { top: options.marginMm ?? 0, left: options.marginMm ?? 0, bottom: options.marginMm ?? 0, right: options.marginMm ?? 0 };
  const gap = typeof options.gapMm === "object" ? options.gapMm : { horizontal: options.gapMm ?? 0, vertical: options.gapMm ?? 0 };
  for (const key of ["top", "left", "bottom", "right"] as const) nonnegative(margin?.[key], `$.marginMm.${key}`);
  for (const key of ["horizontal", "vertical"] as const) nonnegative(gap?.[key], `$.gapMm.${key}`);
  return { margin, gap };
}
function layout(options: LabelSheetOptions) {
  const paper = options.paper === undefined || options.paper === "a4" ? { widthMm: 210, heightMm: 297 } : options.paper;
  positive(paper.widthMm, "$.paper.widthMm"); positive(paper.heightMm, "$.paper.heightMm");
  const columns = positive(options.columns, "$.columns", true), rows = positive(options.rows, "$.rows", true), capacity = columns * rows;
  if (capacity > 1000) throw new LabelSheetError("每张纸不能超过 1000 个位置", "$.columns");
  const { margin, gap } = spacing(options);
  const startSlot = options.startSlot ?? 0, offset = options.offsetMm ?? { x: 0, y: 0 };
  if (!Number.isSafeInteger(startSlot) || startSlot < 0 || startSlot >= capacity) throw new LabelSheetError("起始位置应在首张纸的有效位置内", "$.startSlot");
  if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new LabelSheetError("校准偏移应为有限毫米值", "$.offsetMm");
  return { paper, columns, rows, capacity, margin, gap, startSlot, offset };
}
function componentCount(component: PlanComponent): number {
  return 1 + (component.grid?.cells.reduce((sum, row) => sum + row.length + 1 + row.reduce((count, cell) => count + (cell?.children?.reduce((total, child) => total + componentCount(child), 0) ?? 0), 0), 0) ?? 0);
}
function assertLabelPages(plan: RenderPlan, options: LabelSheetOptions, geometry: ReturnType<typeof layout>): void {
  if (!validateRenderPlan(plan).ok) throw new LabelSheetError("标签计划无效", "$.plan");
  const first = plan.pages[0];
  if (!first) return;
  const { paper, columns, rows, margin, gap, offset } = geometry;
  if (margin.left + offset.x < 0 || margin.top + offset.y < 0 || margin.left + offset.x + columns * first.pageWidthMm + (columns - 1) * gap.horizontal + margin.right > paper.widthMm + 0.000001 || margin.top + offset.y + rows * first.pageHeightMm + (rows - 1) * gap.vertical + margin.bottom > paper.heightMm + 0.000001) throw new LabelSheetError("标签、间距、边距及校准偏移超过纸张尺寸；不会自动缩小标签", "$.paper");
  let count = 0;
  for (const [index, page] of plan.pages.entries()) {
    active(options.signal);
    if (page.layout === "wide" || page.pageWidthMm !== first.pageWidthMm || page.pageHeightMm !== first.pageHeightMm) throw new LabelSheetError("拼版需要尺寸相同的固定标签页面", `$.pages.${index}`);
    count += page.components.reduce((sum, component) => sum + componentCount(component), 0);
    if (count > positive(options.maxComponents ?? 250_000, "$.maxComponents", true)) throw new LabelSheetError("拼版组件总量超过预算", "$.maxComponents");
    for (const component of page.components) if (component.leftMm < 0 || component.topMm < 0 || component.leftMm + component.widthMm > page.pageWidthMm + 0.000001 || component.topMm + component.heightMm > page.pageHeightMm + 0.000001) throw new LabelSheetError("标签内容超出标签边界", `$.pages.${index}.components`);
  }
}
/** Row-major physical imposition. Record → copy → face order is preserved; no duplex reordering. */
export function imposeLabelSheets(plan: RenderPlan, options: LabelSheetOptions): RenderPlan {
  active(options.signal);
  const geometry = layout(options), { paper, columns, capacity, margin, gap, startSlot, offset } = geometry;
  const sheetCount = plan.pages.length ? Math.ceil((startSlot + plan.pages.length) / capacity) : 0;
  if (sheetCount > positive(options.maxSheets ?? 10_000, "$.maxSheets", true)) throw new LabelSheetError("拼版纸张数量超过预算", "$.maxSheets");
  positive(options.maxComponents ?? 250_000, "$.maxComponents", true);
  assertLabelPages(plan, options, geometry);
  const snapshot = snapshotReportJson(plan, { maxBytes: positive(options.maxSnapshotBytes ?? 64_000_000, "$.maxSnapshotBytes", true), check: () => active(options.signal), error: (_code, message) => new LabelSheetError(message, "$.maxSnapshotBytes") });
  const pages: PlanPage[] = Array.from({ length: sheetCount }, () => ({ pageWidthMm: paper.widthMm, pageHeightMm: paper.heightMm, components: [], meta: { labelSheet: { columns, rows: geometry.rows, slots: [] } } }));
  for (const [sourcePageIndex, page] of snapshot.pages.entries()) {
    active(options.signal);
    const position = startSlot + sourcePageIndex, slotIndex = position % capacity, sheet = pages[Math.floor(position / capacity)]!;
    const x = margin.left + offset.x + slotIndex % columns * (page.pageWidthMm + gap.horizontal);
    const y = margin.top + offset.y + Math.floor(slotIndex / columns) * (page.pageHeightMm + gap.vertical);
    const placement = { sourcePageIndex, slotIndex, xMm: x, yMm: y, widthMm: page.pageWidthMm, heightMm: page.pageHeightMm, ...(page.meta ? { sourceMeta: page.meta } : {}) };
    (sheet.meta!.labelSheet as { slots: unknown[] }).slots.push(placement);
    sheet.components.push(...page.components.map(component => ({ ...component, leftMm: component.leftMm + x, topMm: component.topMm + y, meta: { ...component.meta, labelSheet: placement } })));
  }
  return { ...snapshot, pages };
}
