import type {
  ComponentStyle,
  GridCell,
  PlanComponent,
  PlanGrid,
  PlanPage,
  RenderPlan
} from "../schema/render-plan";
import { RENDER_PLAN_SCHEMA_VERSION } from "../schema/render-plan";
import { DEFAULT_FONT_PT, LINE_HEIGHT } from "../defaults";
import { heuristicMeasurer, wrapText, type TextMeasureOptions, type TextMeasurer } from "./textwrap";
import { evalStyleRule, formatValue, toExcelNumberFormat, type ColumnFormat, type StyleRule } from "../format";
import { resolveFontSize } from "../render/style";

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
  return wp.heightMm - (page.marginBottomMm ?? wp.marginBottomMm);
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
        letterSpacingPt: style.letterSpacing === undefined ? undefined : style.letterSpacing * 72 / 96
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
    fontSize: fontSizePt,
    verticalAlign: "middle",
    ...col.style,
    align: alignments[index] === "auto" ? "left" : alignments[index] as ComponentStyle["align"]
  }));
  const autoStyles = cellStyles.map((style, index) => alignments[index] === "auto"
    ? { left: style, center: { ...style, align: "center" as const }, right: { ...style, align: "right" as const } }
    : undefined);
  const ruleStyles = list.columns.map((column, index) => column.rules?.map((rule) => {
    const variants = autoStyles[index];
    if (variants) return {
      left: { ...variants.left, ...rule.style },
      center: { ...variants.center, ...rule.style },
      right: { ...variants.right, ...rule.style }
    };
    const style = { ...cellStyles[index], ...rule.style } as ComponentStyle;
    return { left: style, center: style, right: style };
  }));

  // 表头单元格样式（含底色/加粗），同样驻留
  const headerCellStyles = list.columns.map((col) =>
    ({
      fontSize: fontSizePt,
      bold: list.headerBold ?? true,
      align: "center",
      verticalAlign: "middle",
      backgroundColor: list.headerBackgroundColor,
      ...(col.style || {}),
      ...(list.headerAlign === undefined ? {} : { align: list.headerAlign }),
      ...list.headerStyle,
      ...(col.headerAlign === undefined ? {} : { align: col.headerAlign }),
      ...col.headerStyle
    }) as ComponentStyle
  );

  const headerTexts = list.columns.map((col) => col.header);
  let headerHeight = list.rowHeightMm ?? 0;
  for (let i = 0; i < headerTexts.length; i++) {
    const style = headerCellStyles[i]!;
    const headerFontPt = resolveFontSize(style).fontSizePt;
    const lines = wrapText(
      headerTexts[i]!, list.columns[i]!.widthMm - paddingMm * 2,
      { fontSizePt: headerFontPt, bold: style.bold }, measurer
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
      rowHeightsMm: [headerHeight]
    },
    colWidthsMm,
    columns: list.columns
  };
}

interface ListInterningWithFloor extends ListInterning {
  rowHeightFloorMm: number;
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
    if (typeof value === "number" && inter.numberFormats[i] !== undefined) cell.numberFormat = inter.numberFormats[i];
    cells[i] = cell;
  }
  return {
    grid: { cells: [cells], colWidthsMm: inter.colWidthsMm, rowHeightsMm: [height] },
    heightMm: height
  };
}

export function paginateTemplate(
  template: ReportTemplate,
  datasets: DatasetRows,
  optionsOrMmPerRow: number | PaginateOptions = {}
): PaginateResult {
  // 兼容旧签名 paginateTemplate(tpl, data, mmPerRow: number)
  const options: PaginateOptions =
    typeof optionsOrMmPerRow === "number" ? { mmPerRow: optionsOrMmPerRow } : optionsOrMmPerRow;
  const mmPerRow = options.mmPerRow ?? 0;
  const measurer = options.measurer ?? heuristicMeasurer;
  const warnings: string[] = [];
  const pages: PlanPage[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${(++seq).toString(36)}`;
  /** 含 {totalPages} 占位符的克隆文本组件（分页结束后统一回填总页数） */
  const placeholderClones: PlanComponent[] = [];

  for (const tplPage of template.pages) {
    const current = makeWorkingPage(tplPage);
    const contentBottom = () => toContentBottom(tplPage, current);
    const contentTop = current.marginTopMm;
    /** 页锚组件：含 {page}/{totalPages} 占位符的文本，每个输出页克隆注入（页脚场景） */
    const anchors: PlanComponent[] = [];
    const pushCurrent = () => {
      pages.push({
        pageWidthMm: current.widthMm,
        pageHeightMm: current.heightMm,
        marginTopMm: current.marginTopMm,
        marginBottomMm: current.marginBottomMm,
        marginLeftMm: current.marginLeftMm,
        marginRightMm: current.marginRightMm,
        components: current.components
      });
      if (anchors.length > 0) {
        const pageNo = pages.length;
        for (const anchor of anchors) {
          const clone = {
            ...anchor,
            text: String(anchor.text ?? "").replace(/\{page\}/g, String(pageNo))
          };
          pages[pages.length - 1]!.components.push(clone);
          if (clone.text.includes("{totalPages}")) placeholderClones.push(clone);
        }
      }
    };

    for (const comp of tplPage.components) {
      if (comp.kind !== "list") {
        // 占位符组件转为页锚（每页克隆，模板对象不被污染，可复用分页）
        if (comp.kind === "text" && typeof (comp as PlanComponent).text === "string") {
          const text = (comp as PlanComponent).text as string;
          if (text.includes("{page}") || text.includes("{totalPages}")) {
            anchors.push(comp as PlanComponent);
            continue;
          }
        }
        current.components.push(comp as PlanComponent);
        continue;
      }
      const list = comp;
      const rows = datasets[list.dataset];
      if (!Array.isArray(rows)) {
        warnings.push(`数据集 ${list.dataset} 未提供数据，列表 ${list.id ?? ""} 输出为空`);
      }
      const dataRows = Array.isArray(rows) ? rows : [];

      const columnsWidth = list.columns.reduce((s, c) => s + c.widthMm, 0);
      const scale = columnsWidth > list.widthMm ? list.widthMm / columnsWidth : 1;
      const scaledList: ListComponent =
        scale === 1 ? list : { ...list, columns: list.columns.map((c) => ({ ...c, widthMm: c.widthMm * scale })) };

      const inter: ListInterningWithFloor = {
        ...interList(scaledList, measurer),
        rowHeightFloorMm: scaledList.rowHeightMm ?? 0
      };

      const headerComp: PlanComponent = {
        kind: "rect",
        leftMm: list.leftMm,
        topMm: 0,
        widthMm: list.widthMm,
        heightMm: inter.headerHeightMm,
        grid: inter.headerGrid,
        nid: nextId("listh"),
        style: inter.borderStyle
      };

      let y = list.topMm;
      const placeHeader = (target: WorkingPage, topMm: number) => {
        target.components.push({ ...headerComp, topMm });
      };

      placeHeader(current, y);
      y += inter.headerHeightMm + mmPerRow;

      /** 溢出换页（表头按 headerEveryPage 重复）后返回新页起始 y */
      const ensureSpace = (needMm: number): void => {
        if (y + needMm > contentBottom()) {
          pushCurrent();
          const next = makeWorkingPage(tplPage);
          current.components = next.components;
          current.heightMm = next.heightMm;
          if (scaledList.headerEveryPage !== false) {
            placeHeader(current, list.topMm);
            y = list.topMm + inter.headerHeightMm;
          } else {
            y = contentTop;
          }
        }
      };

      /** 输出一个网格行组件（rect+grid，样式共享 inter.borderStyle） */
      const placeGridRow = (grid: PlanGrid, heightMm: number, nidPrefix: string): void => {
        const freshTop = scaledList.headerEveryPage !== false
          ? list.topMm + inter.headerHeightMm
          : contentTop;
        const availableHeight = contentBottom() - freshTop;
        if (heightMm > availableHeight) {
          warnings.push(
            `列表 ${list.id ?? list.dataset} 行高 ${heightMm.toFixed(2)}mm 超出单页可用高度 ${availableHeight.toFixed(2)}mm，预览与打印可能截断内容`
          );
        }
        ensureSpace(heightMm);
        current.components.push({
          kind: "rect",
          leftMm: list.leftMm,
          topMm: y,
          widthMm: list.widthMm,
          heightMm,
          grid,
          nid: nextId(nidPrefix),
          style: inter.borderStyle
        });
        y += heightMm;
      };

      /** 单行高估算（组头防孤行判断用） */
      const oneRowH = (): number => {
        const g = buildRowGridFast(inter, {}, measurer);
        return g.heightMm;
      };

      /** 构造跨越全部列的单行（组头/小计/合计通用）：label 列 + 各数值列 */
      const buildSpanRow = (
        label: string,
        values: Map<string, GridCell>,
        style: ComponentStyle,
        labelSpanTo: number
      ): { grid: PlanGrid; heightMm: number } => {
        const cells: GridCellCompat[] = [];
        const span = Math.max(1, Math.min(labelSpanTo, scaledList.columns.length));
        const summaryStyle: ComponentStyle = { fontSize: inter.fontSizePt, ...style };
        cells.push({ text: label, colSpan: span, style: { bold: true, ...summaryStyle } });
        for (let i = span; i < scaledList.columns.length; i++) {
          const col = scaledList.columns[i]!;
          const valueCell = values.get(col.field);
          const columnStyle = inter.autoStyles[i]?.[autoAlignment(valueCell?.value, col.format)] ?? inter.cellStyles[i];
          cells.push({ ...valueCell, text: valueCell?.text ?? "", style: { ...columnStyle, ...summaryStyle } });
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
          grid: { cells: [cells], colWidthsMm: inter.colWidthsMm, rowHeightsMm: [height] },
          heightMm: height
        };
      };

      const numericSum = (groupRows: Record<string, unknown>[], field: string): number => {
        let s = 0;
        for (const r of groupRows) {
          const n = typeof r[field] === "number" ? (r[field] as number) : Number(r[field]);
          if (Number.isFinite(n)) s += n;
        }
        return s;
      };
      const formatSum = (groupRows: Record<string, unknown>[], field: string): GridCell => {
        const col = scaledList.columns.find((c) => c.field === field);
        const format = col?.format ?? { kind: "number" as const, thousands: true };
        const value = numericSum(groupRows, field);
        return { text: formatValue(value, format), value, numberFormat: toExcelNumberFormat(format) };
      };

      // ── 分组装配：组头 → 行 → 组尾小计；末尾可选总合计 ──
      const groupBy = scaledList.groupBy;
      const labelSpanFor = (fields: string[]): number => {
        const firstFieldIdx = scaledList.columns.findIndex((c) => fields.includes(c.field));
        return firstFieldIdx > 0 ? firstFieldIdx : 1;
      };

      interface RowUnit {
        kind: "row" | "groupHeader" | "subtotal" | "grand";
        row?: Record<string, unknown>;
        label?: string;
        rows?: Record<string, unknown>[];
      }
      const units: RowUnit[] = [];
      if (groupBy) {
        // Map 归组：与数据到达顺序无关（乱序数据集不产生重复组头/分段小计），
        // 组间顺序保持"首现顺序"
        const groups = new Map<string, Record<string, unknown>[]>();
        for (const r of dataRows) {
          const key = cellText(r[groupBy.field]);
          const bucket = groups.get(key);
          if (bucket) bucket.push(r);
          else groups.set(key, [r]);
        }
        for (const [key, bucket] of groups) {
          units.push({
            kind: "groupHeader",
            label: (groupBy.headerTemplate ?? "{value}").replace(/\{value\}/g, key)
          });
          for (const r of bucket) units.push({ kind: "row", row: r });
          if (groupBy.subtotal && groupBy.subtotal.length > 0) {
            units.push({
              kind: "subtotal",
              label: groupBy.subtotalLabel ?? "小计",
              rows: bucket
            });
          }
        }
      } else {
        for (const r of dataRows) units.push({ kind: "row", row: r });
      }

      const baseRowH = oneRowH();
      for (const unit of units) {
        if (unit.kind === "row") {
          const rowGrid = buildRowGridFast(inter, unit.row!, measurer);
          placeGridRow(rowGrid.grid, rowGrid.heightMm, "listr");
        } else if (unit.kind === "groupHeader") {
          const g = buildSpanRow(
            unit.label!,
            new Map(),
            (groupBy?.headerStyle ?? {}) as ComponentStyle,
            scaledList.columns.length
          );
          // 组头防孤行：页尾放不下"组头+首行"时先换页
          if (groupBy?.keepWithNext !== false && y + g.heightMm + baseRowH > contentBottom()) {
            ensureSpace(g.heightMm + baseRowH);
          }
          placeGridRow(g.grid, g.heightMm, "listg");
        } else if (unit.kind === "subtotal") {
          const values = new Map<string, GridCell>();
          for (const f of groupBy!.subtotal ?? []) values.set(f, formatSum(unit.rows!, f));
          const g = buildSpanRow(
            unit.label!,
            values,
            (groupBy?.subtotalStyle ?? {}) as ComponentStyle,
            labelSpanFor(groupBy!.subtotal ?? [])
          );
          placeGridRow(g.grid, g.heightMm, "listst");
        }
      }

      // 总合计（无分组时需显式 fields 或 grandTotal.fields）
      if (scaledList.grandTotal) {
        const gt =
          typeof scaledList.grandTotal === "object" ? scaledList.grandTotal : undefined;
        const fields = gt?.fields ?? (groupBy?.subtotal ?? []);
        if (fields.length > 0) {
          const values = new Map<string, GridCell>();
          for (const f of fields) values.set(f, formatSum(dataRows, f));
          const g = buildSpanRow(
            gt?.label ?? "合计",
            values,
            (gt?.style ?? {}) as ComponentStyle,
            labelSpanFor(fields)
          );
          placeGridRow(g.grid, g.heightMm, "listgt");
        } else {
          warnings.push(`列表 ${list.id ?? ""} 配置了 grandTotal 但未提供合计字段（groupBy.subtotal 或 grandTotal.fields）`);
        }
      }
    }
    pushCurrent();
  }

  // 占位符收尾：回填 {totalPages}（页脚高度固定，回填不影响分页布局）
  for (const clone of placeholderClones) {
    const text = (clone as { text?: string }).text;
    if (typeof text === "string" && text.includes("{totalPages}")) {
      (clone as { text?: string }).text = text.replace(/\{totalPages\}/g, String(pages.length));
    }
  }

  return {
    plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages },
    warnings
  };
}
