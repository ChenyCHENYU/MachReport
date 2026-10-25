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
import { createTextMeasurementCache } from "./text-measure-cache";
import { compileReportPredicate, type ReportPredicateReader } from "../processing/predicate";
import { formatValue, toExcelNumberFormat } from "../format";
import { computeDataset, type FormulaAdapter } from "../processing/computed";
import { createChartResolver, validateChartComponentLimit, type ChartComponentResolver } from "./chart-layout";
import { aggregateRows, type AggregateDefinition } from "../processing/aggregate";
import { estimateMatrixTable } from "../processing/matrix";
import { matrixRowRole, prepareMatrixHeader, resolveMatrixLayout, type MatrixLayoutMetadata } from "./matrix-layout";
import { createTreeTable, flattenTreeInput, validateTreeComputed, type TreeRow } from "../processing/tree";
export { createTreeTable, validateTreeOptions, TreeRowLimitError, type TreeTableOptions, type TreeRow, type TreeTable } from "../processing/tree";
import { projectListColumns } from "./list-projection";
import type { ReportPageFlow } from "./flow";
export type { ReportPageFlow, ReportFlowBand } from "./flow";
import { paginateFlowPage } from "./flow-layout";
import { templateRequiresRecalculation } from "./template-calculations";
import { mergeComponentStyles, resolveFontSize } from "../render/style";
import { resolveListAutoAlignment, listCellText as cellText, resolveListHeaderStyle, listTreeIndent, applyListTreeMetadata } from "./list-cell";
import type { ReportTemplateRepeat } from "../schema/component-binding";
import { repeatTemplatePages } from "./record-pages";
import { PaginateCellLimitError, PaginatePageLimitError } from "./pagination-errors";
export { PaginateCellLimitError, PaginatePageLimitError, PaginateChartComponentLimitError } from "./pagination-errors";

import { createColumnVisualResolvers, type ColumnVisualResolver } from "./column-visual";
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
  /** Explicit vertical bands preserve source gaps as dynamic regions expand. */
  flow?: ReportPageFlow;
  meta?: Record<string, unknown>;
}

/** Cascader values are unique within each sibling list. */
export interface ReportParamTreeOption { label: string; value: string; children?: ReportParamTreeOption[] }

/** 报表参数定义（声明式，模板自描述参数面：渲染组件据此生成查询面板） */
export interface ReportParamDef {
  /** 参数名（传入 params，与数据集 SQL #{field} 绑定对应） */
  field: string;
  /** 显示名（缺省用 field） */
  label?: string;
  type?: "text" | "number" | "date" | "month" | "year" | "dateRange" | "select" | "multiSelect" | "cascader" | "numberRange";
  /** select 选项 */
  options?: ReportParamTreeOption[];
  /** Opaque host-resolved source key. No URL, credentials or executable code is stored. */
  optionsSource?: string;
  /** Select dependencies must be declared parameters; changing a parent clears descendants. */
  dependsOn?: string[];
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  /** 数字上下界；日期/月/年使用对应规范字符串；dateRange 对两端使用 YYYY-MM-DD 边界（含边界）。 */
  min?: number | string;
  max?: number | string;
  minLength?: number;
  maxLength?: number;
  /** multiSelect item count (maximum 100). Cascader paths are bounded to 16 levels. */
  minItems?: number;
  maxItems?: number;
}

export interface ReportTemplate {
  schemaVersion?: string;
  /** 参数定义（可选；宿主也可经 ReportPreview 的 paramDefs prop 提供，prop 优先） */
  params?: ReportParamDef[];
  /** Fixed label pages repeat in record → copy → template-page order. */
  repeat?: ReportTemplateRepeat;
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
  /** Shared bound-chart primitive budget, checked before expansion; default 50000, range 1..1000000. */
  maxChartComponents?: number;
  signal?: AbortSignal;
  /** Streaming total-page anchors can skip the bounded counting pass when known. */
  knownTotalPages?: number;
  onWarning?: (warning: string) => void;
  /** Trusted formula adapter is passed at execution time; it is never serialized in templates. */
  formula?: FormulaAdapter;
}

export interface PaginateResult {
  plan: RenderPlan;
  warnings: string[];
  /** Actual resolved bound-chart primitives, including empty placeholders. */
  chartComponents: number;
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


/** 列表级驻留产物：热路径（万行循环）中不再逐行/逐格新建样式对象 */
interface ListInterning {
  visuals: Array<ColumnVisualResolver | undefined>;
  visibility: Array<ReportPredicateReader | undefined>;
  ruleReaders: Array<ReportPredicateReader[] | undefined>;
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
  derivedFields: Set<string>;
  tree?: { list: ListComponent; rows: WeakMap<DataRow, TreeRow> };
  matrix?: MatrixLayoutMetadata;
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


function rawCellValue(value: unknown): GridCell["value"] {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function interList(list: ListComponent, measurer: TextMeasurer, rows: readonly DataRow[] = [], signal?: AbortSignal): ListInterning {
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
  const headerCellStyles = list.columns.map((col) => resolveListHeaderStyle(list, col));

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
  const headerGrid = resolveListHeader(prepareMatrixHeader(list, measurer), colWidthsMm, {
    cells: [headerCells], colWidthsMm, rowHeightsMm: [headerHeight], paddingMm
  });

  return {
    fontSizePt,
    paddingMm,
    visuals: createColumnVisualResolvers(list.columns, rows, signal),
    visibility: list.columns.map(column => column.visibleWhen ? compileReportPredicate(column.visibleWhen) : undefined),
    ruleReaders: list.columns.map(column => column.rules?.map(rule => compileReportPredicate(rule.when))),
    cellStyles,
    autoStyles,
    ruleStyles,
    textMetrics: new WeakMap(),
    numberFormats: list.columns.map((column) => toExcelNumberFormat(column.format)),
    derivedFields: new Set(list.computed?.map((field) => field.field)),
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
): GridRow {
  const columns = inter.columns;
  const treeRow = inter.tree?.rows.get(row);
  let height = inter.rowHeightFloorMm;
  const cells: GridCellCompat[] = new Array(columns.length);
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!;
    const visible = inter.visibility[i]?.(row) !== false;
    const rawValue = visible ? row[col.field] : null;
    const alignment = inter.autoStyles[i] ? resolveListAutoAlignment(rawValue, col.format, col.semanticRole) : "left";
    let style = inter.autoStyles[i]?.[alignment] ?? inter.cellStyles[i]!;
    // 条件格式首个命中生效；所有变体在列表级驻留，热路径不构造样式对象。
    if (col.rules) {
      for (let ruleIndex = 0; ruleIndex < col.rules.length; ruleIndex++) {
        if (inter.ruleReaders[i]![ruleIndex]!(row)) {
          style = inter.ruleStyles[i]![ruleIndex]![alignment];
          break;
        }
      }
    }
    // 格式化、测量和输出只遍历一次列；实际字体放大后，后续行按新高度排布。
    const text = col.format ? formatValue(rawValue, col.format) : cellText(rawValue);
    const indentMm = treeCellIndent(inter, col, treeRow);
    style = treeCellStyle(inter, col, style, treeRow);
    const metrics = cellTextMetrics(inter, style);
    const wrapped = wrapText(text, Math.max(1, col.widthMm - inter.paddingMm * 2 - indentMm), metrics.measureOptions, measurer);
    height = Math.max(height, wrapped.length * metrics.lineMm + inter.paddingMm * 2);
    const value = rawCellValue(rawValue);
    const cell: GridCell = { text, style };
    if (rawValue !== null && rawValue !== undefined) inter.visuals[i]?.apply(cell, row);
    if (value !== undefined) cell.value = value;
    applyCellEditMetadata(cell, col, inter.numberFormats[i]);
    applyTreeCellMetadata(cell, col, inter, treeRow, indentMm);
    if (inter.derivedFields.has(col.field)) { cell.derived = true; cell.editable = false; }
    if (!visible) cell.editable = false;
    cells[i] = cell;
  }
  return {
    grid: { cells: [cells], colWidthsMm: inter.colWidthsMm, rowHeightsMm: [height], paddingMm: inter.paddingMm },
    heightMm: height,
    ...(inter.matrix ? { meta: { matrix: { row: inter.matrix.rows.get(row) } } } : {})
  };
}

function treeCellIndent(inter: ListInterningWithFloor, column: ListColumn, row?: TreeRow): number {
  if (!row || column.field !== inter.tree!.list.tree!.labelField) return 0;
  return listTreeIndent(inter.tree!.list, column, row, inter.paddingMm);
}
function treeCellStyle(inter: ListInterningWithFloor, column: ListColumn, style: ComponentStyle, row?: TreeRow): ComponentStyle {
  if (!row || column.field !== inter.tree!.list.tree!.labelField || style.align === "left") return style;
  return { ...style, align: "left" };
}
function applyTreeCellMetadata(cell: GridCell, column: ListColumn, inter: ListInterningWithFloor, row?: TreeRow, indentMm = 0): void {
  if (!row) return;
  if (indentMm) cell.indentMm = indentMm;
  applyListTreeMetadata(cell, column, row, inter.tree!.list);
}

interface GridRow {
  grid: PlanGrid;
  heightMm: number;
  table?: Pick<PlanTableFragment, "id" | "columnKeys" | "title">;
  meta?: Record<string, unknown>;
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
  return first < 0 ? 1 : first;
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
  const span = Math.max(0, Math.min(labelSpanTo, inter.columns.length));
  const summaryStyle = mergeComponentStyles({ fontSize: inter.fontSizePt }, style);
  if (span) cells.push({ text: label, colSpan: span, style: { bold: true, ...summaryStyle } });
  for (let i = span; i < inter.columns.length; i++) {
    const col = inter.columns[i]!;
    const valueCell = values.get(col.field);
    const columnStyle = inter.autoStyles[i]?.[resolveListAutoAlignment(valueCell?.value, col.format)] ?? inter.cellStyles[i];
    cells.push({ ...valueCell, text: valueCell?.text ?? "", style: mergeComponentStyles(columnStyle, style) });
  }
  // 度量占首列时，标签单独成行；不牺牲任何请求的汇总值，raw Excel 仍保留数字。
  const labelCell = { text: label, colSpan: inter.columns.length, style: { bold: true, ...summaryStyle } };
  const rows = span ? [cells] : [[labelCell], cells];
  const heights = rows.map((row) => measureSummaryRow(inter, row, measurer));
  return {
    grid: { cells: rows, colWidthsMm: inter.colWidthsMm, rowHeightsMm: heights, paddingMm: inter.paddingMm },
    heightMm: heights.reduce((sum, height) => sum + height, 0)
  };
}

function measureSummaryRow(inter: ListInterningWithFloor, cells: GridCell[], measurer: TextMeasurer): number {
  let height = inter.rowHeightFloorMm, columnIndex = 0;
  for (const cell of cells) {
    let widthMm = 0;
    const endColumn = columnIndex + (cell.colSpan ?? 1);
    for (; columnIndex < endColumn; columnIndex++) widthMm += inter.colWidthsMm[columnIndex] ?? 0;
    const metrics = cellTextMetrics(inter, cell.style!);
    const lines = wrapText(cell.text ?? "", widthMm - inter.paddingMm * 2, metrics.measureOptions, measurer);
    height = Math.max(height, lines.length * metrics.lineMm + inter.paddingMm * 2);
  }
  return height;
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
  resolveChart: ChartComponentResolver;
  signal?: AbortSignal;
  formula?: FormulaAdapter;
  prepared: WeakMap<ListComponent, PreparedListData>;
  startTop?: number;
  flow?: boolean;
  finished?: (bottom: number) => void;
}

interface ListPageWriter {
  keepTogether(heightMm: number): void;
  setGroupHeader(depth: number, row?: GridRow): void;
  bottom(): number;
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
    table: { ...tableBase, role: "header", rowIndex: -1 }, style: inter.borderStyle, ...(list.meta || inter.matrix ? { meta: { ...list.meta, ...(inter.matrix ? { matrix: inter.matrix.header } : {}) } } : {})
  };
  const placeHeader = (topMm: number) => current.components.push({ ...header, topMm });
  if (context.flow && list.header !== false && inter.headerHeightMm > contentBottom() - contentTop + 0.001) throw new Error(`流式列表 ${list.id ?? list.dataset} 的表头高度超出单页可用范围`);
  let y = Math.max(context.startTop ?? list.topMm, contentTop);
  if (list.header !== false) { placeHeader(y); y += inter.headerHeightMm + context.mmPerRow; }

  function freshTop(): number {
    const top = Math.max(context.flow || templatePage.layout === "wide" ? 0 : list.topMm, continuationTop);
    const headerTop = list.header !== false && list.headerEveryPage !== false ? top + inter.headerHeightMm : continuationTop;
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
    const top = Math.max(context.flow || templatePage.layout === "wide" ? 0 : list.topMm, continuationTop);
    if (list.header !== false && list.headerEveryPage !== false) {
      placeHeader(top);
      y = top + inter.headerHeightMm;
    } else y = continuationTop;
    for (const row of repeatedHeaders.values()) appendGridRow(row, "listgr", "group-header");
  }

  function placeGridRow(row: GridRow, prefix: string, role: PlanTableFragment["role"], source?: PlanTableFragment["source"]): void {
    const available = freshCapacity();
    if (context.flow && row.heightMm > available + 0.001) throw new Error(`流式列表 ${list.id ?? list.dataset} 的单行高度超出单页可用范围`);
    if (row.heightMm > available) warnings.push(`列表 ${list.id ?? list.dataset} 行高 ${row.heightMm.toFixed(2)}mm 超出单页可用高度 ${available.toFixed(2)}mm，预览与打印可能截断内容`);
    ensureSpace(row.heightMm);
    appendGridRow(row, prefix, role, source);
  }
  function appendGridRow(row: GridRow, prefix: string, role: PlanTableFragment["role"], source?: PlanTableFragment["source"]): void {
    const id = row.table?.id ?? tableBase.id;
    const rowIndex = role === "header" ? -1 : rowIndices.get(id) ?? 0;
    if (role !== "header") rowIndices.set(id, rowIndex + row.grid.cells.length);
    current.components.push({
      kind: "rect", leftMm: list.leftMm, topMm: y, widthMm: list.widthMm,
      heightMm: row.heightMm, grid: row.grid, nid: nextId(prefix),
      table: { ...tableBase, ...row.table, role, rowIndex, ...(source ? { source } : {}) }, style: inter.borderStyle, ...(list.meta || row.meta ? { meta: { ...list.meta, ...row.meta } } : {})
    });
    y += row.heightMm;
  }
  function keepTogether(heightMm: number): void {
    // 组合本身放不下新页时，按单行溢出策略处理；不要制造只有表头的额外空页。
    if (heightMm <= freshCapacity()) ensureSpace(heightMm);
  }
  const setGroupHeader = (depth: number, row?: GridRow) => { if (row) repeatedHeaders.set(depth, row); else repeatedHeaders.delete(depth); };
  return { keepTogether, placeGridRow, setGroupHeader, bottom: () => y };
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
  const children = context.datasets[detail.dataset] ?? [], buckets = new Map<string, DataRow[]>(), matched: DataRow[] = [];
  for (const row of children) {
    const value = row[detail.foreignKey];
    if (!validRelationKey(value) && detail.unmatched === "ignore") continue;
    const key = relationKey(value);
    if (!parentKeys.has(key)) { if (detail.unmatched !== "ignore") throw new Error(`明细数据集 ${detail.dataset} 存在未关联的业务键`); continue; }
    const bucket = buckets.get(key); if (bucket) bucket.push(row); else buckets.set(key, [row]);
    matched.push(row);
  }
  const childList = scaleList({ ...list, id: `${list.id ?? list.dataset}:detail`, dataset: detail.dataset, rowKey: detail.rowKey, revisionField: detail.revisionField, sourceTokenField: detail.sourceTokenField, computed: undefined, columns: detail.columns, headerGrid: undefined, rowHeightMm: detail.rowHeightMm ?? list.rowHeightMm, detail: undefined });
  return { list: childList, inter: { ...interList(childList, context.measurer, matched, context.signal), rowHeightFloorMm: childList.rowHeightMm ?? 0 }, rows: buckets, sources: checkedRowSources(childList, matched) };
}
function validRelationKey(value: unknown): boolean {
  return typeof value === "string" && !!value.trim() || typeof value === "number" && Number.isFinite(value);
}
function relationKey(value: unknown): string {
  if (!validRelationKey(value)) throw new Error("主从关联键必须是非空字符串或有限数字");
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
interface PreparedListData { list: ListComponent; rows: DataRow[]; sources?: Map<DataRow, PlanTableFragment["source"]>; treeRows?: WeakMap<DataRow, TreeRow>; totalRows?: DataRow[]; matrix?: MatrixLayoutMetadata }
function checkTreeList(list: ListComponent): void {
  if (list.matrix || list.detail || list.groups?.length || list.groupBy || list.rowVisibleWhen) throw new Error("树形布局不能同时配置普通分组、矩阵、主从或行可见条件");
  if (list.rowKey && list.rowKey !== list.tree!.idField) throw new Error("树形布局的 rowKey 应与 idField 一致");
  if (!list.columns.some(column => column.field === list.tree!.labelField && !column.hidden)) throw new Error("树形布局需要可见的标签列");
  validateTreeComputed(list.tree!, list.computed);
}
function prepareTreeData(list: ListComponent, input: DataRow[], context: ListPageContext): PreparedListData {
  checkTreeList(list);
  const tree = createTreeTable(input, list.tree!, { signal: context.signal, computed: list.computed?.length ? { fields: list.computed, formula: context.formula } : undefined });
  const keyed = { ...list, rowKey: list.tree!.idField }, originalSources = checkedRowSources(keyed, tree.entries.map(entry => entry.original));
  const sources = new Map<DataRow, PlanTableFragment["source"]>(), treeRows = new WeakMap<DataRow, TreeRow>();
  for (const entry of tree.entries) { sources.set(entry.row, originalSources.get(entry.original)); treeRows.set(entry.row, entry); }
  return { list: keyed, rows: tree.rows, sources, treeRows, totalRows: tree.leaves };
}
function prepareRecordData(list: ListComponent, input: DataRow[]): PreparedListData | undefined {
  if (list.cardinality !== "record") return;
  if (input.length > 1) throw new Error(`单记录区域 ${list.id ?? list.dataset} 仅允许 0 或 1 行数据`);
  if (list.tree || list.matrix || list.detail || list.groups?.length || list.groupBy || list.grandTotal || list.rowVisibleWhen) throw new Error("单记录区域不能配置树、矩阵、主从、分组、总计或行过滤");
  if (!input.length) return { list: { ...list, columns: list.columns.map(column => ({ ...column, editable: false })) }, rows: [{}], sources: new Map() };
}
function prepareListData(list: ListComponent, input: DataRow[], context: ListPageContext): PreparedListData {
  const existing = context.prepared.get(list);
  if (existing) return existing;
  const record = prepareRecordData(list, input);
  if (record) { context.prepared.set(list, record); return record; }
  if (list.tree) { const result = prepareTreeData(list, input, context); context.prepared.set(list, result); return result; }
  let rows = list.computed?.length ? computeDataset(input, { fields: list.computed, signal: context.signal, formula: context.formula }).rows : input;
  const originals = rows === input ? undefined : new Map(rows.map((row, index) => [row, input[index]!]));
  if (list.rowVisibleWhen) rows = rows.filter(compileReportPredicate(list.rowVisibleWhen));
  const result: PreparedListData = resolveMatrixLayout(list, rows);
  if (!list.matrix) {
    const sourceRows = checkedRowSources(list, originals ? rows.map((row) => originals.get(row)!) : rows);
    result.sources = originals ? new Map(rows.map((row) => [row, sourceRows.get(originals.get(row)!)])) : sourceRows;
  }
  context.prepared.set(list, result);
  return result;
}
function ensureFlowListStart(list: ListComponent, inter: ListInterningWithFloor, rows: DataRow[], context: ListPageContext): void {
  if (!context.flow) return;
  const { current, templatePage } = context;
  const top = Math.max(current.marginTopMm, headerBottom(templatePage));
  const start = Math.max(context.startTop ?? list.topMm, top);
  const height = (list.header === false ? 0 : inter.headerHeightMm) + (rows[0] ? buildRowGridFast(inter, rows[0], context.measurer).heightMm : 0);
  if (start + height <= toContentBottom(templatePage, current) + 0.001 || start <= top + 0.001) return;
  context.pushCurrent(); current.components = []; current.heightMm = templatePage.heightMm;
  if (templatePage.layout === "wide") { current.marginTopMm = 0; current.marginBottomMm = 0; }
  context.startTop = Math.max(current.marginTopMm, headerBottom(templatePage));
}
function* paginateList(list: ListComponent, input: DataRow[], context: ListPageContext): Generator<PlanPage> {
  const prepared = prepareListData(list, input, context);
  const rows = prepared.rows;
  list = prepared.list;
  if (list.layout === "wide") context.current.widthMm = Math.max(context.current.widthMm, list.leftMm + list.widthMm + context.current.marginRightMm);
  const sources = prepared.sources ?? checkedRowSources(list, rows), scaled = scaleList(list), groups = groupsFor(scaled);
  const inter = { ...interList(scaled, context.measurer, rows, context.signal), rowHeightFloorMm: scaled.rowHeightMm ?? 0, matrix: prepared.matrix, ...(prepared.treeRows ? { tree: { list: scaled, rows: prepared.treeRows } } : {}) };
  ensureFlowListStart(scaled, inter, rows, context);
  const writer = createListPageWriter(scaled, inter, context), detail = detailContext(scaled, rows, context);
  let nextRow: GridRow | undefined;
  for (const unit of listRowUnits(rows, groups)) {
    checkPaginationAbort(context.signal);
    if (unit.kind === "row") {
      writer.placeGridRow(nextRow ?? buildRowGridFast(inter, unit.row, context.measurer), "listr", matrixRowRole(prepared.matrix, unit.row), sources.get(unit.row));
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
  placeGrandTotal(scaled, prepared.totalRows ?? rows, inter, context, writer);
  context.finished?.(writer.bottom());
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
    components: current.components,
    ...(templatePage.meta ? { meta: templatePage.meta } : {})
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
  validateChartComponentLimit(options.maxChartComponents);
}
function flowListHeight(list: ListComponent, context: ListPageContext): number {
  const prepared = prepareListData(list, context.datasets[list.dataset] ?? [], context);
  const scaled = scaleList(prepared.list);
  const inter = { ...interList(scaled, context.measurer, prepared.rows, context.signal), rowHeightFloorMm: scaled.rowHeightMm ?? 0 };
  return (scaled.header === false ? 0 : inter.headerHeightMm) + prepared.rows.reduce((height, row) => height + buildRowGridFast(inter, row, context.measurer).heightMm, 0);
}
function* paginatePageContent(context: ListPageContext): Generator<PlanPage> {
  const { templatePage, current } = context;
  const indices = new Map(templatePage.components.map((component, index) => [component, index]));
  const place = (list: ListComponent, startTop?: number, finished?: (bottom: number) => void) => {
    const rows = context.datasets[list.dataset];
    if (!Array.isArray(rows)) context.warnings.push(`数据集 ${list.dataset} 未提供数据，列表 ${list.id ?? ""} 输出为空`);
    return paginateList(list, Array.isArray(rows) ? rows : [], { ...context, tableId: `${context.tableId}:${indices.get(list)}`, startTop, finished, flow: !!templatePage.flow });
  };
  if (templatePage.flow) {
    yield* paginateFlowPage({ page: templatePage, active: () => checkPaginationAbort(context.signal),
      top: () => Math.max(current.marginTopMm, headerBottom(templatePage)),
      bottom: () => toContentBottom(templatePage, current),
      append: component => { current.components.push(...context.resolveChart(component)); },
      nextPage: () => {
        context.pushCurrent(); current.components = []; current.heightMm = templatePage.heightMm;
        if (templatePage.layout === "wide") { current.marginTopMm = 0; current.marginBottomMm = 0; }
      },
      takePages: context.takePages, height: list => flowListHeight(list, context), list: place
    });
    return;
  }
  for (const component of templatePage.components) {
    if (isPageAnchor(component)) continue;
    if (component.kind === "list") yield* place(component);
    else current.components.push(...context.resolveChart(component));
  }
}
/** Internal generator retains the active page plus at most the row transition queue. */
function* iteratePages(template: ReportTemplate, datasets: DatasetRows, options: PaginateOptions, warnings: string[], totalPages?: number, prepared = new WeakMap<ListComponent, PreparedListData>(), statistics?: Pick<PaginateResult, "chartComponents">): Generator<PlanPage> {
  let sequence = 0, pageNumber = 0, actualCells = 0;
  const measurer = createTextMeasurementCache(options.measurer ?? heuristicMeasurer);
  const resolveChart = createChartResolver(datasets, options.signal, options.maxChartComponents);
  const nextId = (prefix: string) => `${prefix}_${(++sequence).toString(36)}`;
  for (const { pageIndex, page: templatePage } of repeatTemplatePages(template, datasets, options)) {
    checkPaginationAbort(options.signal);
    const current = makeWorkingPage(templatePage), anchors = templatePage.components.filter(isPageAnchor);
    let ready: PlanPage[] = [];
    const pushCurrent = (isFinal = false) => {
      checkPaginationAbort(options.signal);
      if (options.maxPages !== undefined && pageNumber >= options.maxPages) throw new PaginatePageLimitError(options.maxPages, pageNumber + 1);
      if (options.maxCells !== undefined) {
        actualCells += [...current.components, ...anchors].reduce((sum, component) => sum + componentCells(component), 0);
        if (actualCells > options.maxCells) throw new PaginateCellLimitError(options.maxCells, actualCells);
      }
      ready.push(outputPage(templatePage, current, anchors, ++pageNumber, isFinal, totalPages));
    };
    const takePages = () => { const pages = ready; ready = []; return pages; };
    yield* paginatePageContent({ templatePage, current, warnings, nextId, pushCurrent, takePages, datasets, resolveChart, signal: options.signal, formula: options.formula, prepared,
      measurer, mmPerRow: options.mmPerRow ?? 0, tableId: `table:${pageIndex}` });
    pushCurrent(true); yield* takePages();
  }
  if (statistics) statistics.chartComponents = resolveChart.used();
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
  yield* paginateTemplatePagesWithStats(template, datasets, options);
}
/** Internal stats collector used by asynchronous edit reflow; counting-pass usage is excluded. */
export function* paginateTemplatePagesWithStats(template: ReportTemplate, datasets: DatasetRows, options: PaginateOptions, statistics?: Pick<PaginateResult, "chartComponents">): Generator<PlanPage> {
  validatePaginateOptions(options);
  const needsTotal = hasTotalAnchor(template);
  const prepared = new WeakMap<ListComponent, PreparedListData>();
  let total = options.knownTotalPages;
  if (needsTotal && total === undefined) { total = 0; for (const _page of iteratePages(template, datasets, options, [], undefined, prepared)) total++; }
  const warnings: string[] = [];
  let delivered = 0;
  for (const page of iteratePages(template, datasets, options, warnings, total, prepared, statistics)) {
    for (; delivered < warnings.length; delivered++) options.onWarning?.(warnings[delivered]!);
    yield page;
  }
}
/** Compatibility collector: the pagination engine is shared with the bounded page iterator. */
export function paginateTemplate(template: ReportTemplate, datasets: DatasetRows, optionsOrMmPerRow: number | PaginateOptions = {}): PaginateResult {
  const options = typeof optionsOrMmPerRow === "number" ? { mmPerRow: optionsOrMmPerRow } : optionsOrMmPerRow;
  validatePaginateOptions(options);
  const warnings: string[] = [];
  const statistics = { chartComponents: 0 };
  const pages = [...iteratePages(template, datasets, options, warnings, options.knownTotalPages, undefined, statistics)];
  for (const page of pages) page.components = page.components.map((component) => isPageAnchor(component) ? mapAnchorText(component, (text) => text.replace(/\{totalPages\}/g, String(pages.length))) : component);
  warnings.forEach((warning) => options.onWarning?.(warning));
  return { plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, ...(templateRequiresRecalculation(template) ? { requiresRecalculation: true } : {}), pages }, warnings, ...statistics };
}

function estimatedSummaryExtras(list: ListComponent): { groups: number; total: number } {
  const first = list.columns.find((column) => !column.hidden)?.field;
  if (!first) return { groups: 0, total: 0 };
  const groups = groupsFor(list);
  const includes = (fields: string[] = [], aggregates: AggregateDefinition[] = []) => fields.includes(first) || aggregates.some((aggregate) => aggregate.field === first);
  const total = typeof list.grandTotal === "object" ? list.grandTotal : undefined;
  return { groups: groups.filter((group) => includes(group.subtotal, group.aggregates)).length, total: Number(includes(total?.fields ?? groups[0]?.subtotal, total?.aggregates ?? groups[0]?.aggregates)) };
}

/** Conservative cell allocation estimate; relation validation rejects duplicate master keys before rendering. */
function estimateTreeCells(list: ListComponent, datasets: DatasetRows, signal?: AbortSignal): number {
  checkTreeList(list);
  const rows = flattenTreeInput(datasets[list.dataset] ?? [], list.tree!, signal), columns = list.columns.filter(column => !column.hidden).length;
  const headerCells = list.header === false ? 0 : list.headerGrid ? gridCells(list.headerGrid) : columns;
  return rows.length * columns + headerCells + Number(!!list.grandTotal) * 2 * columns;
}
export function estimateListLayoutCells(list: ListComponent, datasets: DatasetRows, options: Pick<PaginateOptions, "formula" | "signal"> = {}): number {
  if (list.tree) return estimateTreeCells(list, datasets, options.signal);
  if (list.matrix) {
    let rows = datasets[list.dataset] ?? [];
    if (list.computed?.length) rows = computeDataset(rows, { fields: list.computed, ...options }).rows;
    if (list.rowVisibleWhen) rows = rows.filter(compileReportPredicate(list.rowVisibleWhen));
    const shape = estimateMatrixTable(rows, list.matrix);
    return shape.cells + (list.header === false ? 0 : shape.columnCount * (list.matrix.hierarchy ? list.matrix.columnFields.length + 1 : 1));
  }
  const rows = datasets[list.dataset]?.length ?? 0, columns = list.columns.filter((column) => !column.hidden).length;
  const groups = groupsFor(list).length;
  // 首列是度量时，小计/总计标签独立成行，预检预算同样计入。
  const extra = estimatedSummaryExtras(list);
  let cells = (rows * (1 + 2 * groups + extra.groups) + Number(!!list.grandTotal) * (1 + extra.total)) * columns;
  cells += list.header === false ? 0 : list.headerGrid ? gridCells(list.headerGrid) : columns;
  if (list.cardinality === "record" && rows === 0) cells += columns;
  if (list.detail) {
    const childRows = datasets[list.detail.dataset]?.length ?? 0, childColumns = list.detail.columns.filter((column) => !column.hidden).length;
    cells += (childRows + rows * (Number(list.detail.header !== false) + Number(!!list.detail.label))) * childColumns;
  }
  if (!Number.isSafeInteger(cells)) throw new RangeError("报表单元格估算超出安全整数预算");
  return cells;
}
