import type { ListComponent, PaginateOptions } from "../layout/paginate";
import { heuristicMeasurer, wrapText } from "../layout/textwrap";
import { DEFAULT_FONT_FAMILY } from "../defaults";
import { resolveFontSize } from "../render/style";
import type { GridCell, PlanComponent, PlanGrid, RenderPlan } from "../schema/render-plan";
import { validateRenderPlan } from "../schema/validate";
import type { ReportCellEdit } from "./apply";
import type { ReportEditSessionPart } from "./session-data";
import { sourceRowKey } from "./session-data";
import { capturePlanGuard } from "./session-snapshot";

interface LocalCandidate { plan: RenderPlan; unchanged(): boolean }
type RowEdits = Map<string, Map<string, ReportCellEdit>>;

function plainList(list: ListComponent): boolean {
  if (list.computed || list.groupBy || list.groups || list.grandTotal || list.tree || list.matrix || list.detail || list.rowVisibleWhen || list.headerGrid) return false;
  return list.columns.every(column => !column.format && !column.rules && !column.visibleWhen && !column.visual);
}
function eligible(parts: readonly ReportEditSessionPart[], pagination: readonly (PaginateOptions | undefined)[]): boolean {
  if (parts.length !== pagination.length || pagination.some(options => options?.measurer || options?.formula || options?.mmPerRow || options?.knownTotalPages !== undefined)) return false;
  return parts.every(part => !part.template.repeat && part.template.pages.every(page => !page.flow && page.components.every(component => component.kind === "list"
    ? plainList(component)
    : !component.binding && !component.chartBinding && !component.grid && !component.table && !component.richParagraphs)));
}
function rowEdits(edits: readonly ReportCellEdit[]): RowEdits | null {
  const rows: RowEdits = new Map();
  for (const edit of edits) {
    if (!edit.source || typeof edit.value !== "string" || typeof edit.previousValue !== "string" || edit.previousText !== edit.previousValue) return null;
    // Keep exceptional/empty paragraph measurement on the complete layout path.
    if (![edit.previousValue, edit.value].every(value => value.trim().length && value.length <= 16_384 && !/[\r\n]/.test(value))) return null;
    const key = sourceRowKey(edit.source), fields = rows.get(key) ?? new Map<string, ReportCellEdit>();
    fields.set(edit.source.field, edit); rows.set(key, fields);
  }
  return rows;
}
function simpleCell(cell: GridCell): boolean {
  return !cell.source && !cell.formula && !cell.derived && !cell.richParagraphs && !cell.children && !cell.dataBar && !cell.numberFormat
    && !cell.colSpan && !cell.rowSpan && !cell.indentMm && !cell.style?.rotateDeg;
}
function plainPlan(plan: RenderPlan): boolean {
  return plan.pages.every(page => page.components.every(component => !component.grid || component.grid.cells.every(row => row.every(cell => !!cell && simpleCell(cell)))));
}
function sameHeight(cell: GridCell, edit: ReportCellEdit, widthMm: number, paddingMm: number): boolean {
  if (!simpleCell(cell) || cell.value !== edit.previousValue || cell.text !== edit.previousText) return false;
  const width = widthMm - paddingMm * 2, style = cell.style;
  const fontSizePt = resolveFontSize(style).fontSizePt;
  if (!Number.isFinite(width) || width < 1 || !Number.isFinite(fontSizePt) || fontSizePt <= 0) return false;
  const metrics = { fontSizePt, fontFamily: style?.fontFamily ?? DEFAULT_FONT_FAMILY, italic: style?.italic, bold: style?.bold, letterSpacingPt: style?.letterSpacing };
  return wrapText(edit.previousText, width, metrics, heuristicMeasurer).length === wrapText(edit.value as string, width, metrics, heuristicMeasurer).length;
}
function plainRowWidth(grid: PlanGrid, component: PlanComponent): boolean {
  const widths = grid.colWidthsMm;
  if (!widths || widths.length !== grid.cells[0]!.length || widths.length !== component.table!.columnKeys.length) return false;
  const sum = widths.reduce((total, width) => total + width, 0);
  // Built-in pagination measures these widths directly. Rendering scales them
  // to the component, so uncertain/custom scaled geometry takes full reflow.
  return Number.isFinite(sum) && Math.abs(sum - component.widthMm) <= Math.max(1e-7, sum * 1e-10);
}
function patchComponent(component: PlanComponent, rows: RowEdits, found: Set<ReportCellEdit>): PlanComponent | null {
  const source = component.table?.source;
  if (component.table?.role !== "body" || source?.rowKey === undefined) return component;
  const fields = rows.get(sourceRowKey({ ...source, rowKey: source.rowKey }));
  if (!fields) return component;
  const grid = component.grid;
  if (!grid || grid.cells.length !== 1 || !plainRowWidth(grid, component) || component.style?.rotateDeg) return null;
  const row = grid.cells[0]!, next = [...row];
  for (let column = 0; column < row.length; column++) {
    const cell = row[column];
    // Explicit sources and structural cells must never be interpreted by the list-column shortcut.
    if (!cell || !simpleCell(cell)) return null;
    const edit = fields.get(component.table!.columnKeys[column]!);
    if (!edit) continue;
    if (!sameHeight(cell, edit, grid.colWidthsMm![column]!, grid.paddingMm ?? 0.5)) return null;
    next[column] = { ...cell, value: edit.value, text: edit.value as string }; found.add(edit);
  }
  return next.some((cell, index) => cell !== row[index]) ? { ...component, grid: { ...grid, cells: [next] } } : component;
}
async function patchPlan(plan: RenderPlan, edits: readonly ReportCellEdit[], signal?: AbortSignal): Promise<RenderPlan | null> {
  const rows = rowEdits(edits);
  if (!rows || !edits.length) return null;
  const found = new Set<ReportCellEdit>(), pages: RenderPlan["pages"] = [];
  let count = 0;
  for (const page of plan.pages) {
    const components: PlanComponent[] = [];
    for (const component of page.components) {
      if (signal?.aborted) return null;
      const next = patchComponent(component, rows, found);
      if (!next) return null;
      components.push(next);
      if (++count % 128 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    pages.push(components.some((component, index) => component !== page.components[index]) ? { ...page, components } : page);
  }
  if (found.size !== edits.length) return null;
  const candidate = { ...plan, pages };
  return validateRenderPlan(candidate).ok ? candidate : null;
}

/** Only owned built-in layout sessions may opt into this internal proof. Unknown/custom
 * pagination always rebuilds. No host setting or approximate geometry is introduced. */
export function createLocalSessionReflow(initial: RenderPlan, parts: readonly ReportEditSessionPart[], pagination: readonly (PaginateOptions | undefined)[]) {
  let enabled = eligible(parts, pagination), current = initial;
  let guard: (() => boolean) | undefined;
  function publish(plan: RenderPlan): void {
    current = plan; guard = undefined;
    if (!enabled) return;
    if (!plainPlan(plan)) { enabled = false; return; }
    try { guard = capturePlanGuard(plan); } catch { enabled = false; }
  }
  publish(initial);
  async function candidate(plan: RenderPlan, edits: readonly ReportCellEdit[], signal?: AbortSignal): Promise<LocalCandidate | null> {
    if (!enabled || plan !== current || !guard?.()) return null;
    const unchanged = guard, next = await patchPlan(plan, edits, signal);
    return next && unchanged() ? { plan: next, unchanged } : null;
  }
  return { candidate, publish };
}
