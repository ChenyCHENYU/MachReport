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
import { DEFAULT_FONT_PT, LINE_HEIGHT } from "../defaults";
import { heuristicMeasurer, wrapText, type TextMeasureOptions, type TextMeasurer } from "./textwrap";
import { evalStyleRule, formatValue, toExcelNumberFormat, type ColumnFormat, type StyleRule } from "../format";
import { mergeComponentStyles, resolveFontSize } from "../render/style";

/** auto：真实数字/显式数值格式居右，日期与布尔居中，其他内容居左。 */
export type ListAlignment = NonNullable<ComponentStyle["align"]> | "auto";

export interface ListColumn {
  header: string;
  field: string;
  widthMm: number;
  style?: ComponentStyle;
  /** 内容对齐，优先于 style.align；数值字符串不会自动判为数字。 */
  align?: ListAlignment;
  /** 独立的表头对齐，不改变内容对齐。 */
  headerAlign?: ComponentStyle["align"];
  /** 独立的表头样式，优先于列表级表头样式。 */
  headerStyle?: ComponentStyle;
  /** 值格式化（声明式）：千分位/小数位、百分比、日期 pattern */
  format?: ColumnFormat;
  /** 条件格式规则（声明式，命中合并进单元格样式；如负数红字） */
  rules?: StyleRule[];
  /** 内容列编辑控制；仍需由预览显式开启 editing，不影响表头/小计只读规则。 */
  editable?: boolean;
  /** 空值列或特殊数据类型可显式声明编辑输入类型。 */
  valueType?: GridCell["valueType"];
}

/** 分组小计配置（声明式，见 ListComponent.groupBy） */
export interface ListGroupBy {
  /** 分组字段（值变化即切组） */
  field: string;
  /** 组头文案模板，{value} 占位（默认 "{value}"） */
  headerTemplate?: string;
  headerStyle?: ComponentStyle;
  /** 需要小计的列字段（组尾输出合计行；数值列求和，其余输出首值/留空） */
  subtotal?: string[];
  subtotalStyle?: ComponentStyle;
  subtotalLabel?: string;
  /** 组头防孤行（默认 true：页尾放不下"组头+首行"时整体换页） */
  keepWithNext?: boolean;
}

export type ListGrandTotal =
  | boolean
  | {
      label?: string;
      style?: ComponentStyle;
      /** 合计列（缺省沿用 groupBy.subtotal） */
      fields?: string[];
    };

export interface ListComponent {
  kind: "list";
  id?: string;
  /** 宽表标记用于连续 Excel；不改变低层列表的列宽和分页算法。 */
  layout?: "page" | "wide";
  /** 逻辑表名称，供 Excel Sheet 命名；不额外生成标题组件。 */
  title?: string;
  leftMm: number;
  topMm: number;
  widthMm: number;
  dataset: string;
  columns: ListColumn[];
  fontSizePt?: number;
  headerBold?: boolean;
  rowHeightMm?: number;
  paddingMm?: number;
  headerEveryPage?: boolean;
  headerBackgroundColor?: string;
  /** 内容默认对齐，列配置可覆盖；低层模板缺省仍为 left。 */
  align?: ListAlignment;
  /** 表头默认对齐，列配置可覆盖。 */
  headerAlign?: ComponentStyle["align"];
  headerStyle?: ComponentStyle;
  border?: boolean;
  /** 分组小计（组头/组尾小计/组头防孤行） */
  groupBy?: ListGroupBy;
  /** 末尾总合计行（依赖 groupBy.subtotal 或显式 fields） */
  grandTotal?: ListGrandTotal;
}

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
  return wp.heightMm - (page.layout === "wide" ? wp.marginBottomMm : (page.marginBottomMm ?? wp.marginBottomMm));
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
        bold: style.bold,
        letterSpacingPt: style.letterSpacing
      },
      lineMm: fontSizePt * (style.lineHeight ?? LINE_HEIGHT) * 25.4 / 72
    };
    inter.textMetrics.set(style, metrics);
  }
  return metrics;
}

function autoAlignment(value: unknown, format?: ColumnFormat): "left" | "center" | "right" {
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
      { fontSizePt: headerFontPt, bold: style.bold, letterSpacingPt: style.letterSpacing }, measurer
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

  return {
    fontSizePt,
    paddingMm,
    cellStyles,
    autoStyles,
    ruleStyles,
    textMetrics: new WeakMap(),
    numberFormats: list.columns.map((column) => toExcelNumberFormat(column.format)),
    borderStyle,
    headerHeightMm: headerHeight,
    headerGrid: {
      cells: [headerCells as GridCellCompat[]],
      colWidthsMm,
      rowHeightsMm: [headerHeight],
      paddingMm
    },
    colWidthsMm,
    columns: list.columns
  };
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
    const rawValue = row[col.field];
    const alignment = inter.autoStyles[i] ? autoAlignment(rawValue, col.format) : "left";
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
}

type DataRow = Record<string, unknown>;
type RowUnit =
  | { kind: "row"; row: DataRow }
  | { kind: "groupHeader"; label: string; firstRow: DataRow }
  | { kind: "subtotal"; label: string; rows: DataRow[] };

/** 只在需要分组时保存组桶；普通明细逐行产生，不再复制完整事件数组。 */
function* listRowUnits(rows: DataRow[], groupBy?: ListGroupBy): Generator<RowUnit> {
  if (!groupBy) {
    for (const row of rows) yield { kind: "row", row };
    return;
  }
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = cellText(row[groupBy.field]);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  for (const [key, bucket] of groups) {
    yield { kind: "groupHeader", label: (groupBy.headerTemplate ?? "{value}").replace(/\{value\}/g, key), firstRow: bucket[0]! };
    for (const row of bucket) yield { kind: "row", row };
    if (groupBy.subtotal?.length) yield { kind: "subtotal", label: groupBy.subtotalLabel ?? "小计", rows: bucket };
  }
}

function numericSum(rows: DataRow[], field: string): number {
  let sum = 0;
  for (const row of rows) {
    const number = typeof row[field] === "number" ? row[field] as number : Number(row[field]);
    if (Number.isFinite(number)) sum += number;
  }
  return sum;
}

function summaryValues(columns: ListColumn[], rows: DataRow[], fields: string[]): Map<string, GridCell> {
  return new Map(fields.map((field) => {
    const format = columns.find((column) => column.field === field)?.format ?? { kind: "number" as const, thousands: true };
    const value = numericSum(rows, field);
    return [field, { text: formatValue(value, format), value, numberFormat: toExcelNumberFormat(format) }];
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
}

interface ListPageWriter {
  keepTogether(heightMm: number): void;
  placeGridRow(row: GridRow, prefix: string, role: PlanTableFragment["role"]): void;
}

/** 仅负责纵向游标、换页与逻辑行来源，不参与分组或汇总计算。 */
function createListPageWriter(list: ListComponent, inter: ListInterningWithFloor, context: ListPageContext): ListPageWriter {
  const { templatePage, current, warnings, nextId, pushCurrent } = context;
  const contentBottom = () => toContentBottom(templatePage, current);
  const contentTop = current.marginTopMm;
  const tableBase = {
    id: context.tableId,
    columnKeys: list.columns.map((column) => column.field),
    ...(list.layout === undefined ? {} : { layout: list.layout }),
    ...(list.title === undefined ? {} : { title: list.title })
  };
  let rowIndex = 0;
  const header: PlanComponent = {
    kind: "rect", leftMm: list.leftMm, topMm: 0, widthMm: list.widthMm,
    heightMm: inter.headerHeightMm, grid: inter.headerGrid, nid: nextId("listh"),
    table: { ...tableBase, role: "header", rowIndex: -1 }, style: inter.borderStyle
  };
  const placeHeader = (topMm: number) => current.components.push({ ...header, topMm });
  let y = list.topMm;
  placeHeader(y);
  y += inter.headerHeightMm + context.mmPerRow;

  function freshTop(): number {
    const top = templatePage.layout === "wide" ? 0 : list.topMm;
    return list.headerEveryPage !== false ? top + inter.headerHeightMm : (templatePage.layout === "wide" ? 0 : contentTop);
  }

  function freshCapacity(): number {
    const marginBottom = templatePage.layout === "wide" ? 0 : current.marginBottomMm;
    return templatePage.heightMm - marginBottom - freshTop();
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
    const top = templatePage.layout === "wide" ? 0 : list.topMm;
    if (list.headerEveryPage !== false) {
      placeHeader(top);
      y = top + inter.headerHeightMm;
    } else y = templatePage.layout === "wide" ? 0 : contentTop;
  }

  function placeGridRow(row: GridRow, prefix: string, role: PlanTableFragment["role"]): void {
    const available = freshCapacity();
    if (row.heightMm > available) warnings.push(`列表 ${list.id ?? list.dataset} 行高 ${row.heightMm.toFixed(2)}mm 超出单页可用高度 ${available.toFixed(2)}mm，预览与打印可能截断内容`);
    ensureSpace(row.heightMm);
    current.components.push({
      kind: "rect", leftMm: list.leftMm, topMm: y, widthMm: list.widthMm,
      heightMm: row.heightMm, grid: row.grid, nid: nextId(prefix),
      table: { ...tableBase, role, rowIndex: rowIndex++ }, style: inter.borderStyle
    });
    y += row.heightMm;
  }
  function keepTogether(heightMm: number): void {
    // 组合本身放不下新页时，按单行溢出策略处理；不要制造只有表头的额外空页。
    if (heightMm <= freshCapacity()) ensureSpace(heightMm);
  }
  return { keepTogether, placeGridRow };
}

function placeGrandTotal(list: ListComponent, rows: DataRow[], inter: ListInterningWithFloor, context: ListPageContext, writer: ListPageWriter): void {
  if (!list.grandTotal) return;
  const total = typeof list.grandTotal === "object" ? list.grandTotal : undefined;
  const fields = total?.fields ?? list.groupBy?.subtotal ?? [];
  if (fields.length === 0) {
    context.warnings.push(`列表 ${list.id ?? ""} 配置了 grandTotal 但未提供合计字段（groupBy.subtotal 或 grandTotal.fields）`);
    return;
  }
  const row = buildSpanRow(inter, context.measurer, total?.label ?? "合计", summaryValues(list.columns, rows, fields), total?.style ?? {}, labelSpanFor(list.columns, fields));
  writer.placeGridRow(row, "listgt", "grand-total");
}

function paginateList(list: ListComponent, rows: DataRow[], context: ListPageContext): void {
  const width = list.columns.reduce((sum, column) => sum + column.widthMm, 0);
  const scale = width > list.widthMm ? list.widthMm / width : 1;
  const scaled = scale === 1 ? list : { ...list, columns: list.columns.map((column) => ({ ...column, widthMm: column.widthMm * scale })) };
  const inter = { ...interList(scaled, context.measurer), rowHeightFloorMm: scaled.rowHeightMm ?? 0 };
  const writer = createListPageWriter(scaled, inter, context);
  let nextRow: GridRow | undefined;
  for (const unit of listRowUnits(rows, scaled.groupBy)) {
    if (unit.kind === "row") {
      writer.placeGridRow(nextRow ?? buildRowGridFast(inter, unit.row, context.measurer), "listr", "body");
      nextRow = undefined;
    } else if (unit.kind === "groupHeader") {
      const row = buildSpanRow(inter, context.measurer, unit.label, new Map(), scaled.groupBy?.headerStyle ?? {}, scaled.columns.length);
      // 使用真实首行高度，包括条件字号与多行内容；下一轮直接复用测量结果。
      nextRow = buildRowGridFast(inter, unit.firstRow, context.measurer);
      if (scaled.groupBy?.keepWithNext !== false) writer.keepTogether(row.heightMm + nextRow.heightMm);
      writer.placeGridRow(row, "listg", "group-header");
    } else {
      const fields = scaled.groupBy?.subtotal ?? [];
      const row = buildSpanRow(inter, context.measurer, unit.label, summaryValues(scaled.columns, unit.rows, fields), scaled.groupBy?.subtotalStyle ?? {}, labelSpanFor(scaled.columns, fields));
      writer.placeGridRow(row, "listst", "subtotal");
    }
  }
  placeGrandTotal(scaled, rows, inter, context, writer);
}

function isPageAnchor(component: TemplateComponent): component is PlanComponent {
  return component.kind === "text" && typeof component.text === "string" && (component.text.includes("{page}") || component.text.includes("{totalPages}"));
}

function pushWorkingPage(templatePage: TemplatePage, current: WorkingPage, anchors: PlanComponent[], pages: PlanPage[], placeholders: PlanComponent[], isFinal: boolean): void {
  const output: PlanPage = {
    pageWidthMm: current.widthMm, pageHeightMm: current.heightMm,
    ...(templatePage.layout === undefined ? {} : { layout: templatePage.layout }),
    marginTopMm: current.marginTopMm, marginBottomMm: current.marginBottomMm,
    marginLeftMm: current.marginLeftMm, marginRightMm: current.marginRightMm,
    components: current.components
  };
  pages.push(output);
  for (const anchor of anchors) {
    const clone = { ...anchor, text: String(anchor.text ?? "").replace(/\{page\}/g, String(pages.length)) };
    output.components.push(clone);
    if (clone.text.includes("{totalPages}")) placeholders.push(clone);
  }
  if (templatePage.layout === "wide") {
    const bottom = output.components.reduce((height, component) => Math.max(height, component.topMm + component.heightMm), 0);
    output.marginBottomMm = isFinal ? (templatePage.marginBottomMm ?? 0) : 0;
    output.pageHeightMm = Math.max(1, bottom + output.marginBottomMm);
  }
}

/** 模板遍历只编排静态组件和列表；行测量、分组、换页与汇总各自独立。 */
export function paginateTemplate(template: ReportTemplate, datasets: DatasetRows, optionsOrMmPerRow: number | PaginateOptions = {}): PaginateResult {
  const options = typeof optionsOrMmPerRow === "number" ? { mmPerRow: optionsOrMmPerRow } : optionsOrMmPerRow;
  const warnings: string[] = [];
  const pages: PlanPage[] = [];
  const placeholders: PlanComponent[] = [];
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${(++sequence).toString(36)}`;
  for (const [pageIndex, templatePage] of template.pages.entries()) {
    const current = makeWorkingPage(templatePage);
    const anchors = templatePage.components.filter(isPageAnchor);
    const pushCurrent = (isFinal = false) => pushWorkingPage(templatePage, current, anchors, pages, placeholders, isFinal);
    for (const [componentIndex, component] of templatePage.components.entries()) {
      if (isPageAnchor(component)) continue;
      if (component.kind !== "list") { current.components.push(component); continue; }
      const rows = datasets[component.dataset];
      if (!Array.isArray(rows)) warnings.push(`数据集 ${component.dataset} 未提供数据，列表 ${component.id ?? ""} 输出为空`);
      paginateList(component, Array.isArray(rows) ? rows : [], {
        templatePage, current, warnings, nextId, pushCurrent,
        measurer: options.measurer ?? heuristicMeasurer, mmPerRow: options.mmPerRow ?? 0,
        tableId: `table:${pageIndex}:${componentIndex}`
      });
    }
    pushCurrent(true);
  }
  for (const component of placeholders) component.text = component.text!.replace(/\{totalPages\}/g, String(pages.length));
  return { plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages }, warnings };
}
