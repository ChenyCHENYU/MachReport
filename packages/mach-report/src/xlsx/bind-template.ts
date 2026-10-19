import type { ListColumn, ListComponent, ReportTemplate, TemplatePage } from "../layout/paginate";
import type { GridCell, PlanGrid } from "../schema/render-plan";
import type { ComponentStyle } from "../schema/render-plan";
import type { ColumnFormat } from "../format";
import { resolveGridLayout } from "../render/grid-geometry";
import { validateReportTemplate } from "../source/template-registry";
import { parseImportRange, type CellRange } from "./import-range";
import type { ExcelImportResult, ExcelImportedSheet } from "./import-types";

export type ExcelBindingColumn = string | (Omit<ListColumn, "widthMm" | "header"> & { header?: string });

export interface ExcelTableBinding {
  sheet: string;
  dataset?: string;
  /** 完整列宽的表头范围，允许多行合并。 */
  header: string;
  /** 将整个样例明细区域替换为动态数据；缺省为表头下方全部行。 */
  detail?: string;
  columns: readonly ExcelBindingColumn[];
  /** Disable sample-cell number-format inference when a business schema is authoritative. */
  inferSampleFormats?: boolean;
  rowKey?: string;
  revisionField?: string;
  sourceTokenField?: string;
  groupBy?: ListComponent["groupBy"];
  grandTotal?: ListComponent["grandTotal"];
}

export interface ExcelTemplateBindingResult {
  template: ReportTemplate;
  warnings: string[];
}

interface ImportedRow { cells: (GridCell | null)[]; height: number }
interface SheetContent { rows: Map<number, ImportedRow>; widths: number[]; page: TemplatePage; range: CellRange }

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function sheetContent(imported: ExcelImportResult, sheet: ExcelImportedSheet): SheetContent {
  const pages = imported.template.pages.slice(sheet.pageStart, sheet.pageStart + sheet.pageCount);
  const page = pages[0];
  if (!page) throw new Error(`工作表 ${sheet.name} 没有可绑定页面`);
  const rows = new Map<number, ImportedRow>();
  let widths: number[] = [];
  for (const item of pages) {
    for (const component of item.components) {
      if (component.kind === "list" || !component.grid || component.meta?.xlsxSheet !== sheet.name) continue;
      const range = parseImportRange(String(component.meta.xlsxRange));
      const grid = component.grid;
      widths = grid.colWidthsMm ?? [];
      grid.cells.forEach((cells, index) => rows.set(range.top + index, { cells: copy(cells), height: grid.rowHeightsMm?.[index] ?? 6 }));
    }
  }
  if (!widths.length || !rows.size) throw new Error(`工作表 ${sheet.name} 缺少导入几何元数据`);
  return { rows, widths: [...widths], page, range: parseImportRange(sheet.range) };
}

function sliceGrid(content: SheetContent, top: number, bottom: number): PlanGrid {
  const cells: (GridCell | null)[][] = [];
  const heights: number[] = [];
  for (let row = top; row <= bottom; row++) {
    const source = content.rows.get(row);
    if (!source) throw new Error(`导入模板缺少第 ${row} 行`);
    for (const cell of source.cells) {
      if (cell && row + (cell.rowSpan ?? 1) - 1 > bottom) throw new Error(`第 ${row} 行合并区域跨越绑定边界，请调整 header/detail 范围`);
    }
    cells.push(copy(source.cells)); heights.push(source.height);
  }
  return { cells, rowHeightsMm: heights, colWidthsMm: content.widths, paddingMm: 0.25 };
}

function checkedRanges(binding: ExcelTableBinding, content: SheetContent) {
  const header = parseImportRange(binding.header);
  const detail = binding.detail ? parseImportRange(binding.detail) : { ...content.range, top: header.bottom + 1 };
  for (const range of [header, detail]) {
    if (range.left !== content.range.left || range.right !== content.range.right || range.top < content.range.top || range.bottom > content.range.bottom || range.top > range.bottom) throw new Error("绑定区域必须位于导入选区内并覆盖其完整列宽");
  }
  if (detail.top !== header.bottom + 1) throw new Error("detail 应紧接 header，避免静态内容被隐式删除");
  if (binding.columns.length !== content.widths.length) throw new Error("columns 应逐列映射整个选区；不能自动猜测业务字段");
  checkMergeBoundaries(content, [header.top, header.bottom + 1, detail.bottom + 1]);
  return { header, detail };
}

function checkMergeBoundaries(content: SheetContent, boundaries: number[]): void {
  for (const [row, source] of content.rows) for (const cell of source.cells) {
    const end = row + (cell?.rowSpan ?? 1);
    if (boundaries.some((boundary) => row < boundary && end > boundary)) throw new Error(`第 ${row} 行合并区域跨越绑定边界，请调整 header/detail 范围`);
  }
}

function headerLeaves(grid: PlanGrid, widths: number[]): Array<GridCell | undefined> {
  const leaves: Array<GridCell | undefined> = [];
  for (const box of resolveGridLayout(grid, widths.reduce((a, b) => a + b, 0), 100).cells) {
    for (let index = box.ci; index < Math.min(widths.length, box.ci + (box.cell.colSpan ?? 1)); index++) leaves[index] = box.cell;
  }
  return leaves;
}

function sampleFormat(cell: GridCell | undefined, explicit: ColumnFormat | undefined, field: string, warnings: string[]): ColumnFormat | undefined {
  if (explicit) return explicit;
  const source = cell?.numberFormat;
  if (!source || source === "General") return undefined;
  const number = /^(#,##)?0(?:\.(0+))?(%)?$/.exec(source);
  if (number) {
    const digits = number[2]?.length ?? 0;
    if (digits <= 100) return number[3] ? { kind: "percent", digits } : { kind: "number", digits, ...(number[1] ? { thousands: true } : {}) };
  }
  warnings.push(`${field}: Excel 数字格式 ${source} 未自动套用到动态数据，请在 columns 中显式声明 format`);
  return undefined;
}

function bindColumns(binding: ExcelTableBinding, header: PlanGrid, sample: PlanGrid, widths: number[], warnings: string[]): ListColumn[] {
  const leaves = headerLeaves(header, widths);
  const samples = resolveGridLayout(sample, widths.reduce((a, b) => a + b, 0), 20).cells;
  if (samples.some(({ cell }) => (cell.colSpan ?? 1) !== 1 || (cell.rowSpan ?? 1) !== 1)) throw new Error("动态明细样例行不能包含合并格；合并表头可以保留");
  const sampleCells = new Map(samples.map((box) => [box.ci, box.cell]));
  const fields = new Set<string>();
  const columns = binding.columns.map((value, index) => {
    const column = typeof value === "string" ? { field: value } : value;
    if (!column || typeof column.field !== "string" || !column.field.trim() || fields.has(column.field)) throw new Error(`columns[${index}] 需要唯一的非空 field`);
    fields.add(column.field);
    const label = leaves[index]?.text ?? column.field;
    const sampleCell = sampleCells.get(index);
    const format = binding.inferSampleFormats === false ? column.format : sampleFormat(sampleCell, column.format, column.field, warnings);
    return { ...column, ...(format ? { format } : {}), header: column.header ?? label, widthMm: widths[index]!, style: { ...sampleCell?.style, ...column.style }, ...(column.semanticRole && !column.align ? { align: "auto" as const } : {}), ...(column.editable === undefined && sampleCell?.editable === false ? { editable: false } : {}) };
  });
  applyHeaderOverrides(binding, leaves, columns);
  return columns;
}

interface HeaderPatch { text?: string; style: ComponentStyle }
function applyHeaderOverrides(binding: ExcelTableBinding, leaves: Array<GridCell | undefined>, columns: ListColumn[]): void {
  const patches = new Map<GridCell, HeaderPatch>();
  binding.columns.forEach((column, index) => {
    const cell = leaves[index];
    if (!cell || typeof column === "string") return;
    const patch = patches.get(cell) ?? { style: {} };
    if (column.header !== undefined) {
      if (patch.text !== undefined && patch.text !== column.header) throw new Error("同一合并表头不能配置不同 header");
      patch.text = column.header;
    }
    mergeHeaderStyle(patch.style, { ...(column.headerAlign ? { align: column.headerAlign } : {}), ...column.headerStyle });
    patches.set(cell, patch);
  });
  for (const [cell, patch] of patches) {
    if (patch.text !== undefined) Object.assign(cell, { text: patch.text, rawText: patch.text, value: patch.text });
    cell.style = { ...cell.style, ...patch.style };
    leaves.forEach((leaf, index) => {
      if (leaf !== cell) return;
      if (patch.text !== undefined) columns[index]!.header = patch.text;
      if (patch.style.align !== undefined) columns[index]!.headerAlign = patch.style.align;
    });
  }
}
function mergeHeaderStyle(target: ComponentStyle, next: ComponentStyle): void {
  for (const key of Object.keys(next) as Array<keyof ComponentStyle>) {
    if (next[key] === undefined) continue;
    if (target[key] !== undefined && target[key] !== next[key]) throw new Error(`同一合并表头不能配置不同 ${key}`);
    Object.assign(target, { [key]: next[key] });
  }
}

function gridPage(content: SheetContent, grid: PlanGrid): TemplatePage {
  const page = content.page;
  const height = grid.rowHeightsMm!.reduce((a, b) => a + b, 0);
  return { ...page, heightMm: Math.max(page.heightMm, height + (page.marginTopMm ?? 0) + (page.marginBottomMm ?? 0)), components: [{ kind: "rect", leftMm: page.marginLeftMm ?? 0, topMm: page.marginTopMm ?? 0, widthMm: content.widths.reduce((a, b) => a + b, 0), heightMm: height, grid }] };
}

function boundPages(imported: ExcelImportResult, sheet: ExcelImportedSheet, binding: ExcelTableBinding, warnings: string[]): TemplatePage[] {
  const content = sheetContent(imported, sheet);
  const { header, detail } = checkedRanges(binding, content);
  // 标题区与多层表头作为同一逻辑表头重复，连续 Excel 只写一次，不混入自由布局。
  const headerGrid = sliceGrid(content, content.range.top, header.bottom);
  const sample = sliceGrid(content, detail.top, detail.top);
  const page: TemplatePage = { ...content.page, components: [] };
  const list: ListComponent = {
    kind: "list", id: `bound:${sheet.name}`, dataset: binding.dataset ?? "detail", title: sheet.name,
    leftMm: page.marginLeftMm ?? 0, topMm: page.marginTopMm ?? 0, widthMm: content.widths.reduce((a, b) => a + b, 0),
    layout: page.layout ?? "page", headerGrid,
    columns: bindColumns(binding, headerGrid, sample, content.widths, warnings), rowHeightMm: sample.rowHeightsMm![0],
    headerEveryPage: true, align: "auto", paddingMm: 0.25,
    ...(binding.rowKey ? { rowKey: binding.rowKey } : {}),
    ...(binding.revisionField ? { revisionField: binding.revisionField } : {}),
    ...(binding.sourceTokenField ? { sourceTokenField: binding.sourceTokenField } : {}),
    ...(binding.groupBy ? { groupBy: binding.groupBy } : {}),
    ...(binding.grandTotal === undefined ? {} : { grandTotal: binding.grandTotal })
  };
  page.components.push(list);
  if (detail.bottom === content.range.bottom) return [page];
  warnings.push(`${sheet.name}: 明细区域后的静态内容保留为后续独立页面，不推断动态页脚定位`);
  return [page, gridPage(content, sliceGrid(content, detail.bottom + 1, content.range.bottom))];
}

/** 将明确声明的 Excel 表区域变成可反复取数的业务模板；不保留样例明细值，不猜接口。 */
export function bindExcelTemplate(imported: ExcelImportResult, bindings: readonly ExcelTableBinding[]): ExcelTemplateBindingResult {
  const validation = validateReportTemplate(imported.template);
  if (!validation.ok) throw new Error(`导入模板无效：${validation.errors[0]?.message}`);
  if (!bindings.length) throw new Error("至少需要一个 Excel 业务绑定");
  const bySheet = new Map<string, ExcelTableBinding>();
  for (const binding of bindings) {
    if (!imported.sheets.some((sheet) => sheet.name === binding.sheet) || bySheet.has(binding.sheet)) throw new Error(`绑定工作表不存在或重复：${binding.sheet}`);
    bySheet.set(binding.sheet, binding);
  }
  const warnings = [...imported.warnings];
  const pages = imported.sheets.flatMap((sheet) => {
    const binding = bySheet.get(sheet.name);
    return binding ? boundPages(imported, sheet, binding, warnings) : copy(imported.template.pages.slice(sheet.pageStart, sheet.pageStart + sheet.pageCount));
  });
  const template = { ...copy(imported.template), pages };
  const result = validateReportTemplate(template);
  if (!result.ok) throw new Error(`业务模板无效：${result.errors[0]?.path} ${result.errors[0]?.message}`);
  return { template, warnings };
}
