import type {
  ComponentStyle,
  GridCell,
  PlanComponent,
  PlanGrid,
  PlanPage,
  PlanTableFragment,
  RenderPlan
} from "../schema/render-plan";
import { RENDER_PLAN_SCHEMA_VERSION } from "../schema/render-plan";
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_PT, LINE_HEIGHT } from "../defaults";
import { heuristicMeasurer, wrapText, type TextMeasureOptions, type TextMeasurer } from "./textwrap";
import { evalStyleRule, formatValue, toExcelNumberFormat, type ColumnFormat } from "../format";
import { computeDataset, type FormulaAdapter } from "../processing/computed";
import { aggregateRows, type AggregateDefinition } from "../processing/aggregate";
import { createMatrixTable, estimateMatrixTable } from "../processing/matrix";
import { projectListColumns } from "./list-projection";
import { mergeComponentStyles, resolveFontSize } from "../render/style";

import type { ListColumn, ListComponent, ListGroupBy } from "./list-model";
export type { ListAlignment, ListColumn, ListComponent, ListGroupBy, ListGrandTotal, ListDetail } from "./list-model";

export type TemplateComponent = PlanComponent | ListComponent;

export interface TemplatePage {
  widthMm: number;
  heightMm: number;
  /** 宽表保持全列自然宽度，页高只控制内部纵向分段。 */
  layout?: "page" | "wide";
  marginTopMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  marginRightMm?: number;
  components: TemplateComponent[];
}

/** 报表参数定义（声明式，模板自描述参数面：渲染组件据此生成查询面板） */
export interface ReportParamDef {
  /** 参数名（传入 params，与数据集 SQL #{field} 绑定对应） */
  field: string;
  /** 显示名（缺省用 field） */
  label?: string;
  type?: "text" | "number" | "date" | "select";
  /** select 选项 */
  options?: Array<{ label: string; value: string }>;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  /** 数字上下界；date 参数使用 YYYY-MM-DD 字符串（含边界）。 */
  min?: number | string;
  max?: number | string;
  minLength?: number;
  maxLength?: number;
}

export interface ReportTemplate {
  schemaVersion?: string;
  /** 参数定义（可选；宿主也可经 ReportPreview 的 paramDefs prop 提供，prop 优先） */
  params?: ReportParamDef[];
  pages: TemplatePage[];
}

export type DatasetRows = Record<string, Record<string, unknown>[]>;

export interface PaginateOptions {
  /** 每行额外占高（mm），压测专用钩子 */
  mmPerRow?: number;
  /** 文本测量器（默认启发式；浏览器端可注入 canvas 测量校准） */
  measurer?: TextMeasurer;
  /** 可选页数上限；在追加超限页前终止，避免先分配全部页面再检查。 */
  maxPages?: number;
  /** Actual grid cells, including repeated furniture and nested children; checked before each page is appended. */
  maxCells?: number;
  signal?: AbortSignal;
  /** Streaming total-page anchors can skip the bounded counting pass when known. */
  knownTotalPages?: number;
  onWarning?: (warning: string) => void;
  /** Trusted formula adapter is passed at execution time; it is never serialized in templates. */
  formula?: FormulaAdapter;
}

export class PaginatePageLimitError extends Error {
  readonly code = "page-limit";
  constructor(readonly limit: number, readonly actual: number) {
    super(`报表页数超出上限 ${limit}（至少 ${actual} 页）`);
    this.name = "PaginatePageLimitError";
  }
}

export class PaginateCellLimitError extends Error {
  readonly code = "cell-limit";
  constructor(readonly limit: number, readonly actual: number) {
    super(`报表单元格数量超出上限 ${limit}（至少 ${actual} 格）`);
    this.name = "PaginateCellLimitError";
  }
}

export interface PaginateResult {
  plan: RenderPlan;
  warnings: string[];
}

interface WorkingPage {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  components: PlanComponent[];
}

function makeWorkingPage(page: TemplatePage): WorkingPage {
  return {
    widthMm: page.widthMm,
    heightMm: page.heightMm,
    marginTopMm: page.marginTopMm ?? 0,
    marginBottomMm: page.marginBottomMm ?? 0,
    marginLeftMm: page.marginLeftMm ?? 0,
    marginRightMm: page.marginRightMm ?? 0,
    components: []
  };
}

function toContentBottom(page: TemplatePage, wp: WorkingPage): number {
  const bottom = wp.heightMm - (page.layout === "wide" ? wp.marginBottomMm : (page.marginBottomMm ?? wp.marginBottomMm));
  return page.components.reduce((limit, component) => component.kind !== "list" && component.pageAnchor === "footer" ? Math.min(limit, component.topMm) : limit, bottom);
}

function headerBottom(page: TemplatePage): number {
  return page.components.reduce((bottom, component) => component.kind !== "list" && component.pageAnchor === "header" ? Math.max(bottom, component.topMm + component.heightMm) : bottom, 0);
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 列表级驻留产物：热路径（万行循环）中不再逐行/逐格新建样式对象 */
interface ListInterning {
  fontSizePt: number;
  paddingMm: number;
  /** 每列常驻单元格样式引用（同列所有行共享同一对象） */
  cellStyles: ComponentStyle[];
  /** auto 列按类型复用三种样式，同类型行不创建新对象。 */
  autoStyles: Array<Record<"left" | "center" | "right", ComponentStyle> | undefined>;
  /** 条件规则与对齐变体预合成，同一列/规则/类型复用最终样式。 */
  ruleStyles: Array<Array<Record<"left" | "center" | "right", ComponentStyle>> | undefined>;
  textMetrics: WeakMap<ComponentStyle, CellTextMetrics>;
  numberFormats: Array<string | undefined>;
  /** 列表整体边框样式（所有行/表头共享） */
  borderStyle: ComponentStyle;
  headerHeightMm: number;
  headerGrid: PlanGrid;
  /** 缩放后的列宽：所有行共享，避免渲染后端按单元格数均分或截断跨度后的列 */
  colWidthsMm: number[];
  columns: ListColumn[];
}

type GridCellCompat = GridCell;

interface CellTextMetrics {
  measureOptions: TextMeasureOptions;
  lineMm: number;
}

function cellTextMetrics(inter: ListInterning, style: ComponentStyle): CellTextMetrics {
  let metrics = inter.textMetrics.get(style);
  if (!metrics) {
    const fontSizePt = resolveFontSize(style).fontSizePt;
    metrics = {
      measureOptions: {
        fontSizePt,
        fontFamily: style.fontFamily ?? DEFAULT_FONT_FAMILY,
        italic: style.italic,
        bold: style.bold,
        letterSpacingPt: style.letterSpacing
      },
      lineMm: fontSizePt * (style.lineHeight ?? LINE_HEIGHT) * 25.4 / 72
    };
    inter.textMetrics.set(style, metrics);
  }
  return metrics;
}

function autoAlignment(value: unknown, format?: ColumnFormat, role?: ListColumn["semanticRole"]): "left" | "center" | "right" {
  if (role === "identifier" || role === "dimension" || role === "date") return "center";
  if (role === "measure") return "right";
  if (role === "text") return "left";
  if (format?.kind === "number" || format?.kind === "percent") return "right";
  if (format?.kind === "date" || value instanceof Date || typeof value === "boolean") return "center";
  return typeof value === "number" && Number.isFinite(value) ? "right" : "left";
}

function rawCellValue(value: unknown): GridCell["value"] {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function interList(list: ListComponent, measurer: TextMeasurer): ListInterning {
  const fontSizePt = list.fontSizePt ?? DEFAULT_FONT_PT;
  const paddingMm = list.paddingMm ?? 1;

  const alignments = list.columns.map((col) => col.align ?? col.style?.align ?? list.align ?? "left");
  // 每列样式驻留：auto 只预建三种对齐，避免每行分配新对象。
  const cellStyles = list.columns.map((col, index): ComponentStyle => ({
    ...mergeComponentStyles({
      fontSize: fontSizePt,
      verticalAlign: "middle"
    }, col.style),
    align: alignments[index] === "auto" ? "left" : alignments[index] as ComponentStyle["align"]
  }));
  const autoStyles = cellStyles.map((style, index) => alignments[index] === "auto"
    ? { left: style, center: { ...style, align: "center" as const }, right: { ...style, align: "right" as const } }
    : undefined);
  const ruleStyles = list.columns.map((column, index) => column.rules?.map((rule) => {
    const variants = autoStyles[index];
    if (variants) return {
      left: mergeComponentStyles(variants.left, rule.style),
      center: mergeComponentStyles(variants.center, rule.style),
      right: mergeComponentStyles(variants.right, rule.style)
    };
    const style = mergeComponentStyles(cellStyles[index], rule.style);
    return { left: style, center: style, right: style };
  }));

  // 表头单元格样式（含底色/加粗），同样驻留
  const headerCellStyles = list.columns.map((col) => {
    let style: ComponentStyle = mergeComponentStyles({
      fontSize: fontSizePt,
      bold: list.headerBold ?? true,
      align: "center",
      verticalAlign: "middle",
      backgroundColor: list.headerBackgroundColor
    }, col.style);
    if (list.headerAlign !== undefined) style.align = list.headerAlign;
    style = mergeComponentStyles(style, list.headerStyle);
    if (col.headerAlign !== undefined) style.align = col.headerAlign;
    return mergeComponentStyles(style, col.headerStyle);
  });

  const headerTexts = list.columns.map((col) => col.header);
  let headerHeight = list.rowHeightMm ?? 0;
  for (let i = 0; i < headerTexts.length; i++) {
    const style = headerCellStyles[i]!;
    const headerFontPt = resolveFontSize(style).fontSizePt;
    const lines = wrapText(
      headerTexts[i]!, list.columns[i]!.widthMm - paddingMm * 2,
      { fontSizePt: headerFontPt, fontFamily: style.fontFamily ?? DEFAULT_FONT_FAMILY, italic: style.italic, bold: style.bold, letterSpacingPt: style.letterSpacing }, measurer
    );
    const lineMm = (headerFontPt * (style.lineHeight ?? LINE_HEIGHT) * 25.4) / 72;
    headerHeight = Math.max(headerHeight, Math.max(lines.length, 1) * lineMm + paddingMm * 2);
  }

  const headerCells: GridCellCompat[] = headerTexts.map((text, i) => ({
    text,
    style: headerCellStyles[i]
  }));

  // border:false → 四边全关（下游 resolveBoxBorders 据此不画内外线）
  const borderStyle: ComponentStyle =
    list.border === false
      ? { borderTop: false, borderRight: false, borderBottom: false, borderLeft: false }
      : { borderBottom: true, borderLeft: true, borderRight: true, borderTop: true };
  const colWidthsMm = list.columns.map((col) => col.widthMm);
  const headerGrid = resolveListHeader(list.headerGrid, colWidthsMm, {
    cells: [headerCells], colWidthsMm, rowHeightsMm: [headerHeight], paddingMm
  });

  return {
    fontSizePt,
    paddingMm,
    cellStyles,
    autoStyles,
    ruleStyles,
    textMetrics: new WeakMap(),
    numberFormats: list.columns.map((column) => toExcelNumberFormat(column.format)),
    borderStyle,
    headerHeightMm: headerGrid.rowHeightsMm!.reduce((sum, height) => sum + height, 0),
    headerGrid,
    colWidthsMm,
    columns: list.columns
  };
}

function resolveListHeader(custom: PlanGrid | undefined, widths: number[], fallback: PlanGrid): PlanGrid {
  if (!custom) return fallback;
  if (!custom.cells.length) throw new Error("自定义列表表头至少需要一行");
  const heights = custom.rowHeightsMm ?? custom.cells.map(() => fallback.rowHeightsMm![0]!);
  if (heights.length !== custom.cells.length || heights.some((height) => !Number.isFinite(height) || height <= 0)) throw new Error("自定义列表表头行高无效");
  return { ...custom, colWidthsMm: widths, rowHeightsMm: heights };
}

interface ListInterningWithFloor extends ListInterning {
  rowHeightFloorMm: number;
}

function applyCellEditMetadata(cell: GridCell, column: ListColumn, numberFormat: string | undefined): void {
  const numeric = column.format?.kind === "number" || column.format?.kind === "percent";
  if (column.valueType !== undefined) cell.valueType = column.valueType;
  else if (numeric) cell.valueType = "number";
  if (column.editable !== undefined) cell.editable = column.editable;
  if ((typeof cell.value === "number" || cell.value == null) && numberFormat !== undefined) cell.numberFormat = numberFormat;
}

/** 单行 → 网格；最终样式先确定，折行与行高使用同一字号/加粗/行距。 */
function buildRowGridFast(
  inter: ListInterningWithFloor,
  row: Record<string, unknown>,
  measurer: TextMeasurer
): { grid: PlanGrid; heightMm: number } {
  const columns = inter.columns;
  let height = inter.rowHeightFloorMm;
  const cells: GridCellCompat[] = new Array(columns.length);
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!;
    const rawValue = col.visibleWhen && !evalStyleRule(row, col.visibleWhen) ? null : row[col.field];
    const alignment = inter.autoStyles[i] ? autoAlignment(rawValue, col.format, col.semanticRole) : "left";
    let style = inter.autoStyles[i]?.[alignment] ?? inter.cellStyles[i]!;
    // 条件格式首个命中生效；所有变体在列表级驻留，热路径不构造样式对象。
    if (col.rules) {
      for (let ruleIndex = 0; ruleIndex < col.rules.length; ruleIndex++) {
        const rule = col.rules[ruleIndex]!;
        if (evalStyleRule(row, rule.when)) {
          style = inter.ruleStyles[i]![ruleIndex]![alignment];
          break;
        }
      }
    }
    // 格式化、测量和输出只遍历一次列；实际字体放大后，后续行按新高度排布。
    const text = col.format ? formatValue(rawValue, col.format) : cellText(rawValue);
    const metrics = cellTextMetrics(inter, style);
    const wrapped = wrapText(text, col.widthMm - inter.paddingMm * 2, metrics.measureOptions, measurer);
    height = Math.max(height, wrapped.length * metrics.lineMm + inter.paddingMm * 2);
    const value = rawCellValue(rawValue);
    const cell: GridCell = { text, style };
    if (value !== undefined) cell.value = value;
    applyCellEditMetadata(cell, col, inter.numberFormats[i]);
    if (col.visibleWhen && rawValue === null && !evalStyleRule(row, col.visibleWhen)) cell.editable = false;
    cells[i] = cell;
  }
  return {
    grid: { cells: [cells], colWidthsMm: inter.colWidthsMm, rowHeightsMm: [height], paddingMm: inter.paddingMm },
    heightMm: height
  };
}

interface GridRow {
  grid: PlanGrid;
  heightMm: number;
  table?: Pick<PlanTableFragment, "id" | "columnKeys" | "title">;
}

type DataRow = Record<string, unknown>;
type RowUnit =
  | { kind: "row"; row: DataRow }
  | { kind: "groupHeader"; label: string; firstRow: DataRow; group: ListGroupBy; depth: number; rows: DataRow[] }
  | { kind: "subtotal"; label: string; rows: DataRow[]; group: ListGroupBy; depth: number }
  | { kind: "groupEnd"; depth: number };

function groupingKey(value: unknown): string {
  if (value != null && typeof value !== "string" && typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value))) throw new Error("分组字段应为有限 JSON 标量");
  return JSON.stringify([typeof value, value ?? null]);
}
/** Buckets contain input references only; no complete event or render-plan array is retained. */
function* listRowUnits(rows: DataRow[], groups: ListGroupBy[], depth = 0): Generator<RowUnit> {
  const group = groups[depth];
  if (!group) { for (const row of rows) yield { kind: "row", row }; return; }
  const buckets = new Map<string, DataRow[]>();
  for (const row of rows) { const key = groupingKey(row[group.field]); const bucket = buckets.get(key); if (bucket) bucket.push(row); else buckets.set(key, [row]); }
  for (const bucket of buckets.values()) {
    const label = (group.headerTemplate ?? "{value}").replace(/\{value\}/g, cellText(bucket[0]![group.field]));
    yield { kind: "groupHeader", label, firstRow: bucket[0]!, group, depth, rows: bucket };
    yield* listRowUnits(bucket, groups, depth + 1);
    if (group.subtotal?.length || group.aggregates?.length) yield { kind: "subtotal", label: group.subtotalLabel ?? "小计", rows: bucket, group, depth };
    yield { kind: "groupEnd", depth };
  }
}

function summaryValues(columns: ListColumn[], rows: DataRow[], fields: string[], aggregates: AggregateDefinition[] = []): Map<string, GridCell> {
  const definitions: AggregateDefinition[] = [...fields.filter((field) => !aggregates.some((item) => item.field === field)).map((field): AggregateDefinition => ({ field, op: "sum" })), ...aggregates];
  return new Map(definitions.map((definition) => {
    const format = columns.find((column) => column.field === definition.field)?.format ?? { kind: "number" as const, thousands: true };
    const value = aggregateRows(rows, { ...definition, field: definition.valueField ?? definition.field });
    return [definition.field, { text: formatValue(value, format), ...(value === null ? {} : { value }), ...(typeof value === "number" ? { numberFormat: toExcelNumberFormat(format) } : {}) }];
  }));
}

function labelSpanFor(columns: ListColumn[], fields: string[]): number {
  const first = columns.findIndex((column) => fields.includes(column.field));
  return first > 0 ? first : 1;
}

function buildSpanRow(
  inter: ListInterningWithFloor,
  measurer: TextMeasurer,
  label: string,
  values: Map<string, GridCell>,
  style: ComponentStyle,
  labelSpanTo: number
): GridRow {
  const cells: GridCellCompat[] = [];
  const span = Math.max(1, Math.min(labelSpanTo, inter.columns.length));
  const summaryStyle = mergeComponentStyles({ fontSize: inter.fontSizePt }, style);
  cells.push({ text: label, colSpan: span, style: { bold: true, ...summaryStyle } });
  for (let i = span; i < inter.columns.length; i++) {
    const col = inter.columns[i]!;
    const valueCell = values.get(col.field);
    const columnStyle = inter.autoStyles[i]?.[autoAlignment(valueCell?.value, col.format)] ?? inter.cellStyles[i];
    cells.push({ ...valueCell, text: valueCell?.text ?? "", style: mergeComponentStyles(columnStyle, style) });
  }
  let height = inter.rowHeightFloorMm;
  let columnIndex = 0;
  for (const cell of cells) {
    let widthMm = 0;
    const endColumn = columnIndex + (cell.colSpan ?? 1);
    for (; columnIndex < endColumn; columnIndex++) widthMm += inter.colWidthsMm[columnIndex] ?? 0;
    const metrics = cellTextMetrics(inter, cell.style!);
    const lines = wrapText(cell.text ?? "", widthMm - inter.paddingMm * 2, metrics.measureOptions, measurer);
    height = Math.max(height, lines.length * metrics.lineMm + inter.paddingMm * 2);
  }
  return {
    grid: { cells: [cells], colWidthsMm: inter.colWidthsMm, rowHeightsMm: [height], paddingMm: inter.paddingMm },
    heightMm: height
  };
}

interface ListPageContext {
  templatePage: TemplatePage;
  current: WorkingPage;
  warnings: string[];
  measurer: TextMeasurer;
  mmPerRow: number;
  tableId: string;
  nextId(prefix: string): string;
  pushCurrent(isFinal?: boolean): void;
  takePages(): PlanPage[];
  datasets: DatasetRows;
  signal?: AbortSignal;
  formula?: FormulaAdapter;
  prepared: WeakMap<ListComponent, PreparedListData>;
}

interface ListPageWriter {
  keepTogether(heightMm: number): void;
  setGroupHeader(depth: number, row?: GridRow): void;
  placeGridRow(row: GridRow, prefix: string, role: PlanTableFragment["role"], source?: PlanTableFragment["source"]): void;
}

/** 仅负责纵向游标、换页与逻辑行来源，不参与分组或汇总计算。 */
function createListPageWriter(list: ListComponent, inter: ListInterningWithFloor, context: ListPageContext): ListPageWriter {
  const { templatePage, current, warnings, nextId, pushCurrent } = context;
  const contentBottom = () => toContentBottom(templatePage, current);
  const contentTop = Math.max(current.marginTopMm, headerBottom(templatePage));
  const continuationTop = templatePage.layout === "wide" ? headerBottom(templatePage) : contentTop;
  const tableBase = {
    id: context.tableId,
    columnKeys: list.columns.map((column) => column.field),
    ...(list.layout === undefined ? {} : { layout: list.layout }),
    ...(list.title === undefined ? {} : { title: list.title })
  };
  const rowIndices = new Map<string, number>();
  const repeatedHeaders = new Map<number, GridRow>();
  const header: PlanComponent = {
    kind: "rect", leftMm: list.leftMm, topMm: 0, widthMm: list.widthMm,
    heightMm: inter.headerHeightMm, grid: inter.headerGrid, nid: nextId("listh"),
    table: { ...tableBase, role: "header", rowIndex: -1 }, style: inter.borderStyle
  };
  const placeHeader = (topMm: number) => current.components.push({ ...header, topMm });
  let y = Math.max(list.topMm, contentTop);
  placeHeader(y);
  y += inter.headerHeightMm + context.mmPerRow;

  function freshTop(): number {
    const top = Math.max(templatePage.layout === "wide" ? 0 : list.topMm, continuationTop);
    const headerTop = list.headerEveryPage !== false ? top + inter.headerHeightMm : continuationTop;
    return headerTop + [...repeatedHeaders.values()].reduce((sum, row) => sum + row.heightMm, 0);
  }

  function freshCapacity(): number {
    const marginBottom = templatePage.layout === "wide" ? 0 : current.marginBottomMm;
    return Math.min(templatePage.heightMm - marginBottom, toContentBottom(templatePage, current)) - freshTop();
  }

  function ensureSpace(heightMm: number): void {
    if (y + heightMm <= contentBottom()) return;
    pushCurrent();
    current.components = [];
    current.heightMm = templatePage.heightMm;
    if (templatePage.layout === "wide") {
      current.marginTopMm = 0;
      current.marginBottomMm = 0;
    }
    const top = Math.max(templatePage.layout === "wide" ? 0 : list.topMm, continuationTop);
    if (list.headerEveryPage !== false) {
      placeHeader(top);
      y = top + inter.headerHeightMm;
    } else y = continuationTop;
    for (const row of repeatedHeaders.values()) appendGridRow(row, "listgr", "group-header");
  }

  function placeGridRow(row: GridRow, prefix: string, role: PlanTableFragment["role"], source?: PlanTableFragment["source"]): void {
    const available = freshCapacity();
    if (row.heightMm > available) warnings.push(`列表 ${list.id ?? list.dataset} 行高 ${row.heightMm.toFixed(2)}mm 超出单页可用高度 ${available.toFixed(2)}mm，预览与打印可能截断内容`);
    ensureSpace(row.heightMm);
    appendGridRow(row, prefix, role, source);
  }
  function appendGridRow(row: GridRow, prefix: string, role: PlanTableFragment["role"], source?: PlanTableFragment["source"]): void {
    const id = row.table?.id ?? tableBase.id;
    const rowIndex = role === "header" ? -1 : rowIndices.get(id) ?? 0;
    if (role !== "header") rowIndices.set(id, rowIndex + 1);
    current.components.push({
      kind: "rect", leftMm: list.leftMm, topMm: y, widthMm: list.widthMm,
      heightMm: row.heightMm, grid: row.grid, nid: nextId(prefix),
      table: { ...tableBase, ...row.table, role, rowIndex, ...(source ? { source } : {}) }, style: inter.borderStyle
    });
    y += row.heightMm;
  }
  function keepTogether(heightMm: number): void {
    // 组合本身放不下新页时，按单行溢出策略处理；不要制造只有表头的额外空页。
    if (heightMm <= freshCapacity()) ensureSpace(heightMm);
  }
  const setGroupHeader = (depth: number, row?: GridRow) => { if (row) repeatedHeaders.set(depth, row); else repeatedHeaders.delete(depth); };
  return { keepTogether, placeGridRow, setGroupHeader };
}

function rowSource(list: ListComponent, row: DataRow): PlanTableFragment["source"] {
  if (!list.rowKey) return undefined;
  const rowKey = row[list.rowKey];
  if ((typeof rowKey !== "string" || !rowKey.trim()) && !(typeof rowKey === "number" && Number.isFinite(rowKey))) {
    throw new Error(`数据集 ${list.dataset} 的 ${list.rowKey} 应为稳定的字符串或有限数字主键`);
  }
  const revision = list.revisionField ? row[list.revisionField] : undefined;
  const sourceToken = list.sourceTokenField ? row[list.sourceTokenField] : undefined;
  if (revision !== undefined && typeof revision !== "string" && !(typeof revision === "number" && Number.isFinite(revision))) throw new Error("业务修订号应为字符串或有限数字");
  if (sourceToken !== undefined && typeof sourceToken !== "string") throw new Error("来源令牌应为字符串");
  return { datasetId: list.dataset, rowKey, ...(revision === undefined ? {} : { revision }), ...(sourceToken === undefined ? {} : { sourceToken }) };
}

function checkedRowSources(list: ListComponent, rows: DataRow[]): Map<DataRow, PlanTableFragment["source"]> {
  const result = new Map<DataRow, PlanTableFragment["source"]>();
  if (!list.rowKey) return result;
  const keys = new Set<string>();
  for (const row of rows) {
    const source = rowSource(list, row)!;
    const key = JSON.stringify(source.rowKey);
    if (keys.has(key)) throw new Error(`数据集 ${list.dataset} 的业务主键重复：${String(source.rowKey)}`);
    keys.add(key);
    result.set(row, source);
  }
  return result;
}

function placeGrandTotal(list: ListComponent, rows: DataRow[], inter: ListInterningWithFloor, context: ListPageContext, writer: ListPageWriter): void {
  if (!list.grandTotal) return;
  const total = typeof list.grandTotal === "object" ? list.grandTotal : undefined;
  const group = groupsFor(list)[0];
  const fields = total?.fields ?? group?.subtotal ?? [];
  const aggregates = total?.aggregates ?? group?.aggregates ?? [];
  if (fields.length === 0 && aggregates.length === 0) {
    context.warnings.push(`列表 ${list.id ?? ""} 配置了 grandTotal 但未提供合计字段（groupBy.subtotal 或 grandTotal.fields）`);
    return;
  }
  const row = buildSpanRow(inter, context.measurer, total?.label ?? "合计", summaryValues(list.columns, rows, fields, aggregates), total?.style ?? {}, labelSpanFor(list.columns, [...fields, ...aggregates.map((item) => item.field)]));
  writer.placeGridRow(row, "listgt", "grand-total");
}

function checkPaginationAbort(signal?: AbortSignal): void {
  if (signal?.aborted) { const error = new Error("报表排版已取消"); error.name = "AbortError"; throw error; }
}
function groupsFor(list: ListComponent): ListGroupBy[] {
  const groups = list.groups ?? (list.groupBy ? [list.groupBy] : []);
  if (groups.length > 16) throw new Error("列表最多支持 16 级分组");
  return groups;
}
function scaleList(list: ListComponent): ListComponent {
  const projected = projectListColumns(list);
  const width = projected.columns.reduce((sum, column) => sum + column.widthMm, 0);
  const scale = width > projected.widthMm ? projected.widthMm / width : 1;
  return scale === 1 ? projected : { ...projected, columns: projected.columns.map((column) => ({ ...column, widthMm: column.widthMm * scale })) };
}
interface DetailContext { list: ListComponent; inter: ListInterningWithFloor; rows: Map<string, DataRow[]>; sources: Map<DataRow, PlanTableFragment["source"]> }
function detailContext(list: ListComponent, rows: DataRow[], context: ListPageContext): DetailContext | undefined {
  const detail = list.detail;
  if (!detail) return undefined;
  const parentKeys = new Set<string>();
  for (const row of rows) { const key = relationKey(row[detail.parentKey]); if (parentKeys.has(key)) throw new Error("主从明细的主表关联键重复"); parentKeys.add(key); }
  const children = context.datasets[detail.dataset] ?? [], buckets = new Map<string, DataRow[]>();
  for (const row of children) {
    const key = relationKey(row[detail.foreignKey]);
    if (!parentKeys.has(key)) { if (detail.unmatched !== "ignore") throw new Error(`明细数据集 ${detail.dataset} 存在未关联的业务键`); continue; }
    const bucket = buckets.get(key); if (bucket) bucket.push(row); else buckets.set(key, [row]);
  }
  const childList = scaleList({ ...list, id: `${list.id ?? list.dataset}:detail`, dataset: detail.dataset, rowKey: detail.rowKey, columns: detail.columns, headerGrid: undefined, rowHeightMm: detail.rowHeightMm ?? list.rowHeightMm, detail: undefined });
  return { list: childList, inter: { ...interList(childList, context.measurer), rowHeightFloorMm: childList.rowHeightMm ?? 0 }, rows: buckets, sources: checkedRowSources(childList, children) };
}
function relationKey(value: unknown): string {
  if ((typeof value !== "string" || !value.trim()) && !(typeof value === "number" && Number.isFinite(value))) throw new Error("主从关联键必须是非空字符串或有限数字");
  return groupingKey(value);
}
function* placeDetails(master: ListComponent, row: DataRow, detail: DetailContext | undefined, context: ListPageContext, writer: ListPageWriter): Generator<PlanPage> {
  if (!detail) return;
  const rows = detail.rows.get(relationKey(row[master.detail!.parentKey])) ?? [];
  if (!rows.length) return;
  const table = { id: `${context.tableId}:detail`, columnKeys: detail.list.columns.map((column) => column.field), title: master.detail!.label };
  if (master.detail!.label) writer.placeGridRow({ ...buildSpanRow(detail.inter, context.measurer, master.detail!.label, new Map(), {}, detail.list.columns.length), table }, "listdl", "group-header");
  if (master.detail!.header !== false) writer.placeGridRow({ grid: detail.inter.headerGrid, heightMm: detail.inter.headerHeightMm, table }, "listdh", "header");
  yield* context.takePages();
  for (const child of rows) {
    checkPaginationAbort(context.signal);
    writer.placeGridRow({ ...buildRowGridFast(detail.inter, child, context.measurer), table }, "listdr", "body", detail.sources.get(child));
    yield* context.takePages();
  }
}
function resolveMatrix(list: ListComponent, rows: DataRow[]): { list: ListComponent; rows: DataRow[] } {
  if (!list.matrix) return { list, rows };
  if (list.detail || list.groupBy || list.groups?.length || list.grandTotal) throw new Error("矩阵不能同时配置普通分组、总计或主从明细");
  const result = createMatrixTable(rows, list.matrix);
  const columns: ListColumn[] = result.columns.map((column, index) => ({ ...column, widthMm: index === 0 ? list.matrix!.rowWidthMm ?? 40 : list.matrix!.columnWidthMm ?? 28, editable: false, align: index === 0 ? "center" : "right" }));
  const derived: ListComponent = { ...list, columns, headerGrid: undefined, rowKey: undefined, revisionField: undefined, sourceTokenField: undefined };
  if (list.layout === "wide") derived.widthMm = columns.reduce((sum, column) => sum + column.widthMm, 0);
  return { list: derived, rows: result.rows };
}
interface PreparedListData { list: ListComponent; rows: DataRow[] }
function prepareListData(list: ListComponent, input: DataRow[], context: ListPageContext): PreparedListData {
  const existing = context.prepared.get(list);
  if (existing) return existing;
  let rows = list.computed?.length ? computeDataset(input, { fields: list.computed, signal: context.signal, formula: context.formula }).rows : input;
  if (list.rowVisibleWhen) rows = rows.filter((row) => evalStyleRule(row, list.rowVisibleWhen!));
  const result = resolveMatrix(list, rows);
  context.prepared.set(list, result);
  return result;
}
function* paginateList(list: ListComponent, input: DataRow[], context: ListPageContext): Generator<PlanPage> {
  const prepared = prepareListData(list, input, context);
  const rows = prepared.rows;
  list = prepared.list;
  if (list.layout === "wide") context.current.widthMm = Math.max(context.current.widthMm, list.leftMm + list.widthMm + context.current.marginRightMm);
  const sources = checkedRowSources(list, rows), scaled = scaleList(list), groups = groupsFor(scaled);
  const inter = { ...interList(scaled, context.measurer), rowHeightFloorMm: scaled.rowHeightMm ?? 0 };
  const writer = createListPageWriter(scaled, inter, context), detail = detailContext(scaled, rows, context);
  let nextRow: GridRow | undefined;
  for (const unit of listRowUnits(rows, groups)) {
    checkPaginationAbort(context.signal);
    if (unit.kind === "row") {
      writer.placeGridRow(nextRow ?? buildRowGridFast(inter, unit.row, context.measurer), "listr", "body", sources.get(unit.row));
      nextRow = undefined;
      yield* context.takePages();
      yield* placeDetails(scaled, unit.row, detail, context, writer);
    } else if (unit.kind === "groupHeader") {
      const row = buildSpanRow(inter, context.measurer, unit.label, new Map(), unit.group.headerStyle ?? {}, scaled.columns.length);
      nextRow ??= buildRowGridFast(inter, unit.firstRow, context.measurer);
      const followingHeaders = groups.slice(unit.depth + 1).reduce((height, group) => height + buildSpanRow(inter, context.measurer, (group.headerTemplate ?? "{value}").replace(/\{value\}/g, cellText(unit.firstRow[group.field])), new Map(), group.headerStyle ?? {}, scaled.columns.length).heightMm, 0);
      if (unit.group.keepWithNext !== false) writer.keepTogether(row.heightMm + followingHeaders + nextRow.heightMm);
      writer.placeGridRow(row, "listg", "group-header");
      if (unit.group.repeatHeader) writer.setGroupHeader(unit.depth, row);
    } else if (unit.kind === "subtotal") {
      const fields = unit.group.subtotal ?? [], aggregates = unit.group.aggregates ?? [];
      const row = buildSpanRow(inter, context.measurer, unit.label, summaryValues(scaled.columns, unit.rows, fields, aggregates), unit.group.subtotalStyle ?? {}, labelSpanFor(scaled.columns, [...fields, ...aggregates.map((item) => item.field)]));
      writer.placeGridRow(row, "listst", "subtotal");
    } else writer.setGroupHeader(unit.depth);
    yield* context.takePages();
  }
  placeGrandTotal(scaled, rows, inter, context, writer);
  yield* context.takePages();
}

function isPageAnchor(component: TemplateComponent): component is PlanComponent {
  return component.kind !== "list" && (component.pageAnchor !== undefined || (component.kind === "text" && typeof component.text === "string" && (component.text.includes("{page}") || component.text.includes("{totalPages}"))));
}

function mapAnchorText(component: PlanComponent, replace: (text: string) => string): PlanComponent {
  return {
    ...component,
    ...(component.text === undefined ? {} : { text: replace(component.text) }),
    ...(component.lines ? { lines: component.lines.map(replace) } : {}),
    ...(component.richParagraphs ? { richParagraphs: component.richParagraphs.map((paragraph) => ({ ...paragraph, segments: paragraph.segments.map((segment) => ({ ...segment, ...(segment.text === undefined ? {} : { text: replace(segment.text) }) })) })) } : {}),
    ...(component.grid ? { grid: { ...component.grid, cells: component.grid.cells.map((row) => row.map((cell) => cell ? { ...cell, ...(cell.text === undefined ? {} : { text: replace(cell.text) }), ...(cell.children ? { children: cell.children.map((child) => mapAnchorText(child, replace)) } : {}) } : null)) } } : {})
  };
}
function hasTotalAnchor(template: ReportTemplate): boolean {
  let result = false;
  for (const page of template.pages) for (const component of page.components) if (isPageAnchor(component)) mapAnchorText(component, (text) => { if (text.includes("{totalPages}")) result = true; return text; });
  return result;
}
function outputPage(templatePage: TemplatePage, current: WorkingPage, anchors: PlanComponent[], pageNumber: number, isFinal: boolean, totalPages?: number): PlanPage {
  const output: PlanPage = {
    pageWidthMm: current.widthMm, pageHeightMm: current.heightMm,
    ...(templatePage.layout === undefined ? {} : { layout: templatePage.layout }),
    marginTopMm: current.marginTopMm, marginBottomMm: current.marginBottomMm,
    marginLeftMm: current.marginLeftMm, marginRightMm: current.marginRightMm,
    components: current.components
  };
  const replace = (text: string) => {
    const paged = text.replace(/\{page\}/g, String(pageNumber));
    return totalPages === undefined ? paged : paged.replace(/\{totalPages\}/g, String(totalPages));
  };
  for (const anchor of anchors) output.components.push(mapAnchorText(anchor, replace));
  if (templatePage.layout === "wide") {
    const bottom = output.components.reduce((height, component) => Math.max(height, component.topMm + component.heightMm), 0);
    output.marginBottomMm = isFinal ? (templatePage.marginBottomMm ?? 0) : 0;
    output.pageHeightMm = Math.max(1, bottom + output.marginBottomMm);
  }
  return output;
}
function gridCells(grid: PlanGrid): number {
  return grid.cells.reduce((sum, row) => sum + row.reduce((count, cell) => count + (cell ? 1 + (cell.children?.reduce((nested, child) => nested + componentCells(child), 0) ?? 0) : 0), 0), 0);
}
function componentCells(component: PlanComponent): number { return component.grid ? gridCells(component.grid) : 0; }
function validatePaginateOptions(options: PaginateOptions): void {
  for (const key of ["maxPages", "maxCells", "knownTotalPages"] as const) if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! < 1)) throw new RangeError(`${key} 应为正安全整数`);
}
/** Internal generator retains the active page plus at most the row transition queue. */
function* iteratePages(template: ReportTemplate, datasets: DatasetRows, options: PaginateOptions, warnings: string[], totalPages?: number, prepared = new WeakMap<ListComponent, PreparedListData>()): Generator<PlanPage> {
  let sequence = 0, pageNumber = 0, actualCells = 0;
  const nextId = (prefix: string) => `${prefix}_${(++sequence).toString(36)}`;
  for (const [pageIndex, templatePage] of template.pages.entries()) {
    checkPaginationAbort(options.signal);
    const current = makeWorkingPage(templatePage), anchors = templatePage.components.filter(isPageAnchor);
    let ready: PlanPage[] = [];
    const pushCurrent = (isFinal = false) => {
      if (options.maxPages !== undefined && pageNumber >= options.maxPages) throw new PaginatePageLimitError(options.maxPages, pageNumber + 1);
      if (options.maxCells !== undefined) {
        actualCells += [...current.components, ...anchors].reduce((sum, component) => sum + componentCells(component), 0);
        if (actualCells > options.maxCells) throw new PaginateCellLimitError(options.maxCells, actualCells);
      }
      ready.push(outputPage(templatePage, current, anchors, ++pageNumber, isFinal, totalPages));
    };
    const takePages = () => { const pages = ready; ready = []; return pages; };
    for (const [componentIndex, component] of templatePage.components.entries()) {
      if (isPageAnchor(component)) continue;
      if (component.kind !== "list") { current.components.push(component); continue; }
      const rows = datasets[component.dataset];
      if (!Array.isArray(rows)) warnings.push(`数据集 ${component.dataset} 未提供数据，列表 ${component.id ?? ""} 输出为空`);
      yield* paginateList(component, Array.isArray(rows) ? rows : [], {
        templatePage, current, warnings, nextId, pushCurrent, takePages, datasets, signal: options.signal, formula: options.formula, prepared,
        measurer: options.measurer ?? heuristicMeasurer, mmPerRow: options.mmPerRow ?? 0, tableId: `table:${pageIndex}:${componentIndex}`
      });
    }
    pushCurrent(true); yield* takePages();
  }
}
/** Counting pass does not keep page grids, components or a RenderPlan alive. */
export function countTemplatePages(template: ReportTemplate, datasets: DatasetRows, options: PaginateOptions = {}): number {
  validatePaginateOptions(options);
  let count = 0;
  for (const _page of iteratePages(template, datasets, { ...options, onWarning: undefined }, [])) count++;
  return count;
}
/** Genuine page-level layout. With total-page anchors, use knownTotalPages or a bounded counting pass. */
export function* paginateTemplatePages(template: ReportTemplate, datasets: DatasetRows, options: PaginateOptions = {}): Generator<PlanPage> {
  validatePaginateOptions(options);
  const needsTotal = hasTotalAnchor(template);
  const prepared = new WeakMap<ListComponent, PreparedListData>();
  let total = options.knownTotalPages;
  if (needsTotal && total === undefined) { total = 0; for (const _page of iteratePages(template, datasets, options, [], undefined, prepared)) total++; }
  const warnings: string[] = [];
  let delivered = 0;
  for (const page of iteratePages(template, datasets, options, warnings, total, prepared)) {
    for (; delivered < warnings.length; delivered++) options.onWarning?.(warnings[delivered]!);
    yield page;
  }
}
/** Compatibility collector: the pagination engine is shared with the bounded page iterator. */
export function paginateTemplate(template: ReportTemplate, datasets: DatasetRows, optionsOrMmPerRow: number | PaginateOptions = {}): PaginateResult {
  const options = typeof optionsOrMmPerRow === "number" ? { mmPerRow: optionsOrMmPerRow } : optionsOrMmPerRow;
  validatePaginateOptions(options);
  const warnings: string[] = [];
  const pages = [...iteratePages(template, datasets, options, warnings, options.knownTotalPages)];
  for (const page of pages) page.components = page.components.map((component) => isPageAnchor(component) ? mapAnchorText(component, (text) => text.replace(/\{totalPages\}/g, String(pages.length))) : component);
  warnings.forEach((warning) => options.onWarning?.(warning));
  return { plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages }, warnings };
}

/** Conservative cell allocation estimate; relation validation rejects duplicate master keys before rendering. */
export function estimateListLayoutCells(list: ListComponent, datasets: DatasetRows, options: Pick<PaginateOptions, "formula" | "signal"> = {}): number {
  if (list.matrix) {
    let rows = datasets[list.dataset] ?? [];
    if (list.computed?.length) rows = computeDataset(rows, { fields: list.computed, ...options }).rows;
    if (list.rowVisibleWhen) rows = rows.filter((row) => evalStyleRule(row, list.rowVisibleWhen!));
    const shape = estimateMatrixTable(rows, list.matrix);
    return shape.cells + shape.columnCount;
  }
  const rows = datasets[list.dataset]?.length ?? 0, columns = list.columns.filter((column) => !column.hidden).length;
  const groups = groupsFor(list).length;
  let cells = (rows * (1 + 2 * groups) + Number(!!list.grandTotal)) * columns;
  cells += list.headerGrid ? gridCells(list.headerGrid) : columns;
  if (list.detail) {
    const childRows = datasets[list.detail.dataset]?.length ?? 0, childColumns = list.detail.columns.filter((column) => !column.hidden).length;
    cells += (childRows + rows * (Number(list.detail.header !== false) + Number(!!list.detail.label))) * childColumns;
  }
  if (!Number.isSafeInteger(cells)) throw new RangeError("报表单元格估算超出安全整数预算");
  return cells;
}
