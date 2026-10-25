import type { ListColumn, ListComponent, ReportTemplate, TemplatePage } from "../layout/paginate";
import type { ComponentStyle } from "../schema/render-plan";
import { PAPER_SIZES } from "../units";
import { resolvePaper, type PageOptions, type PaperName } from "./template-builder";
import { validateDatasetRows, type DatasetContract } from "../schema/dataset";

/** 明细列：显式 widthMm 优先；纸张模式按 flex 分余量，宽表模式按 flex 放大基准列宽。 */
export type TableTemplateColumn = Omit<ListColumn, "widthMm"> & {
  widthMm?: number;
  /** 自动列的宽度权重，默认 1（有 widthMm 时不参与分配）。 */
  flex?: number;
};

/** 同一字段契约生成列语义和表头，业务侧无需复制另一份字段清单。 */
export function columnsFromContract(contract: DatasetContract, overrides: Record<string, Partial<TableTemplateColumn>> = {}): TableTemplateColumn[] {
  validateDatasetRows([], contract);
  return contract.fields.map((field) => ({
    field: field.field,
    header: `${field.label ?? field.field}${field.unit ? ` (${field.unit})` : ""}`,
    semanticRole: field.semanticRole ?? (field.type === "number" || field.type === "decimal" ? "measure" : field.type === "date" ? "date" : field.enum ? "dimension" : "text"),
    ...(field.format ? { format: { ...field.format } } : {}),
    ...overrides[field.field]
  }));
}

export type TableTemplateListOptions = Partial<
  Omit<ListComponent, "kind" | "leftMm" | "topMm" | "widthMm" | "dataset" | "columns" | "layout" | "title">
>;

export interface TableTemplateOptions extends PageOptions {
  /** page 保持旧版纸张布局；wide 按所有列的自然宽度扩展，纵向分段仅供预览与渲染。 */
  layout?: "page" | "wide";
  /** 宽表模式自动列的基准宽度，默认 30mm；widthMm 优先，flex 为基准宽度的倍数。 */
  columnWidthMm?: number;
  title?: string;
  /** 标题占高，默认 10mm；没有标题时不占空间。 */
  titleHeightMm?: number;
  /** 标题与表格间距，默认 4mm。 */
  titleGapMm?: number;
  titleStyle?: ComponentStyle;
  dataset?: string;
  columns: readonly TableTemplateColumn[];
  /** 纸张模式默认 A4；与 layout: "wide" 互斥；页边距各默认 10mm。 */
  paper?: PaperName | { widthMm: number; heightMm: number };
  params?: ReportTemplate["params"];
  /** 沿用列表的字号、行高、重复表头、分组、小计与总计配置。 */
  listOptions?: TableTemplateListOptions;
}

function checkNumber(value: number, name: string, allowZero = false): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${name} 必须是有限${allowZero ? "非负" : "正"}数`);
  }
}

function checkAlignment(value: unknown, name: string, allowAuto: boolean): void {
  if (value !== undefined && !["left", "center", "right", "justify", ...(allowAuto ? ["auto"] : [])].includes(value as string)) {
    throw new Error(`${name} 必须是 left/center/right/justify${allowAuto ? "/auto" : ""}`);
  }
}

type TableLayout = NonNullable<TableTemplateOptions["layout"]>;
type TableMargins = Required<NonNullable<PageOptions["margins"]>>;

function resolveTableLayout(options: TableTemplateOptions): { layout: TableLayout; columnWidthMm: number } {
  const layout = options.layout ?? "page";
  if (layout !== "page" && layout !== "wide") {
    throw new Error("layout 必须是 page 或 wide");
  }
  if (layout === "wide" && (options.paper !== undefined || options.landscape !== undefined)) {
    throw new Error("宽表布局不能同时指定 paper 或 landscape；标准纸型请使用 layout: \"page\"");
  }
  if (layout !== "wide" && options.columnWidthMm !== undefined) {
    throw new Error("columnWidthMm 仅适用于 layout: \"wide\"");
  }
  const columnWidthMm = options.columnWidthMm ?? 30;
  checkNumber(columnWidthMm, "columnWidthMm");
  return { layout, columnWidthMm };
}

function resolveTablePaper(options: TableTemplateOptions): { widthMm: number; heightMm: number } {
  const paper = options.paper === undefined ? "a4" : options.paper;
  if (
    (typeof paper !== "string" && (typeof paper !== "object" || paper === null)) ||
    (options.landscape !== undefined && typeof options.landscape !== "boolean")
  ) {
    throw new Error("paper 必须是纸张预设名或 { widthMm, heightMm } 对象，landscape 必须是布尔值");
  }
  if (typeof paper === "string" && !Object.prototype.hasOwnProperty.call(PAPER_SIZES, paper)) {
    throw new Error(`未知纸张预设 "${paper}"（可用：${Object.keys(PAPER_SIZES).join("/")}）`);
  }
  const resolvedPaper = resolvePaper(paper, undefined, options.landscape);
  const widthMm = resolvedPaper.widthMm;
  const heightMm = resolvedPaper.heightMm;
  checkNumber(widthMm, "纸张 widthMm");
  checkNumber(heightMm, "纸张 heightMm");

  return { widthMm, heightMm };
}

function resolveTableMargins(options: TableTemplateOptions): TableMargins {
  if (options.margins !== undefined && (!options.margins || typeof options.margins !== "object" || Array.isArray(options.margins))) {
    throw new Error("margins 必须是页边距对象");
  }
  const pageMargins = options.margins ?? {};
  const margins = {
    marginTopMm: pageMargins.marginTopMm === undefined ? 10 : pageMargins.marginTopMm,
    marginBottomMm: pageMargins.marginBottomMm === undefined ? 10 : pageMargins.marginBottomMm,
    marginLeftMm: pageMargins.marginLeftMm === undefined ? 10 : pageMargins.marginLeftMm,
    marginRightMm: pageMargins.marginRightMm === undefined ? 10 : pageMargins.marginRightMm
  };
  for (const [name, value] of Object.entries(margins)) checkNumber(value, name, true);
  return margins;
}

function resolveTableHeading(options: TableTemplateOptions, availableHeightMm: number) {
  const dataset = options.dataset === undefined ? "detail" : options.dataset;
  if (typeof dataset !== "string" || !dataset.trim()) {
    throw new Error("dataset 必须是非空字符串");
  }
  if (options.title !== undefined && typeof options.title !== "string") {
    throw new Error("title 必须是字符串");
  }
  const titleHeightMm = options.titleHeightMm === undefined ? 10 : options.titleHeightMm;
  const titleGapMm = options.titleGapMm === undefined ? 4 : options.titleGapMm;
  checkNumber(titleHeightMm, "titleHeightMm");
  checkNumber(titleGapMm, "titleGapMm", true);
  const hasTitle = options.title !== undefined && options.title.length > 0;
  const titleSpaceMm = hasTitle ? titleHeightMm + titleGapMm : 0;
  if (titleSpaceMm >= availableHeightMm) {
    throw new Error("标题高度与间距占满页面，必须为表格保留可用高度");
  }

  return { dataset, titleHeightMm, hasTitle, titleSpaceMm };
}

function resolveListOptions(options: TableTemplateOptions): TableTemplateListOptions {
  if (options.listOptions !== undefined && (!options.listOptions || typeof options.listOptions !== "object" || Array.isArray(options.listOptions))) {
    throw new Error("listOptions 必须是列表配置对象");
  }
  const listOptions = options.listOptions ?? {};
  checkAlignment(listOptions.align, "listOptions.align", true);
  checkAlignment(listOptions.headerAlign, "listOptions.headerAlign", false);
  for (const name of ["fontSizePt", "rowHeightMm", "paddingMm"] as const) {
    const value = listOptions[name];
    if (value !== undefined) checkNumber(value, `listOptions.${name}`, name === "paddingMm");
  }

  return listOptions;
}

function validateTableColumns(columns: readonly TableTemplateColumn[]) {
  let fixedWidthMm = 0;
  let maxFlex = 0;
  for (const [index, column] of columns.entries()) {
    if (!column || typeof column.header !== "string" || typeof column.field !== "string" || !column.field.trim()) {
      throw new Error(`columns[${index}] 需要字符串 header 与非空 field`);
    }
    checkAlignment(column.align, `columns[${index}].align`, true);
    checkAlignment(column.headerAlign, `columns[${index}].headerAlign`, false);
    if (column.flex !== undefined) checkNumber(column.flex, `columns[${index}].flex`);
    if (column.widthMm !== undefined) {
      checkNumber(column.widthMm, `columns[${index}].widthMm`);
      fixedWidthMm += column.widthMm;
    } else {
      maxFlex = Math.max(maxFlex, column.flex ?? 1);
    }
  }
  return { fixedWidthMm, maxFlex };
}

function resolveTableColumns(
  options: TableTemplateOptions,
  layout: TableLayout,
  columnWidthMm: number,
  availableWidthMm: number
) {
  const { fixedWidthMm, maxFlex } = validateTableColumns(options.columns);
  if (layout === "page" && fixedWidthMm > availableWidthMm) {
    throw new Error(`固定列宽 ${fixedWidthMm}mm 超出页面可用宽度 ${availableWidthMm}mm`);
  }
  const remainingWidthMm = availableWidthMm - fixedWidthMm;
  if (layout === "page" && maxFlex > 0 && remainingWidthMm <= 0) {
    throw new Error("固定列占满页面可用宽度，自动列需要正的剩余宽度");
  }
  // 先归一化权重，避免多个合法但很大的 flex 求和溢出。
  const flexTotal = maxFlex > 0
    ? options.columns.reduce((sum, column) => sum + (column.widthMm === undefined ? (column.flex ?? 1) / maxFlex : 0), 0)
    : 0;
  const columns: ListColumn[] = options.columns.map(({ widthMm: fixed, flex: _flex, ...column }, index) => {
    const resolvedWidthMm = fixed ?? (layout === "wide"
      ? columnWidthMm * (_flex ?? 1)
      : remainingWidthMm * ((_flex ?? 1) / maxFlex) / flexTotal);
    checkNumber(resolvedWidthMm, `columns[${index}] 分配后的 widthMm`);
    return { ...column, widthMm: resolvedWidthMm };
  });
  return { columns, fixedWidthMm, maxFlex };
}

/**
 * 创建明细模板；校验、列宽分配、标题与页面装配分别处理。
 * page 自动列共享纸张余量；wide 保留自然列宽，公开配置保持不变。
 */
export function createTableTemplate(options: TableTemplateOptions): ReportTemplate {
  if (!options || typeof options !== "object") {
    throw new Error("标准明细模板需要 options 对象");
  }
  if (!Array.isArray(options.columns) || options.columns.length === 0) {
    throw new Error("columns 至少需要一列");
  }
  const { layout, columnWidthMm } = resolveTableLayout(options);
  const paper = resolveTablePaper(options);
  let widthMm = paper.widthMm;
  const heightMm = paper.heightMm;
  const margins = resolveTableMargins(options);
  let availableWidthMm = widthMm - margins.marginLeftMm - margins.marginRightMm;
  const availableHeightMm = heightMm - margins.marginTopMm - margins.marginBottomMm;
  if ((layout === "page" && availableWidthMm <= 0) || availableHeightMm <= 0) {
    throw new Error("页边距占满纸张，必须保留正的可用宽度和高度");
  }
  const { dataset, titleHeightMm, hasTitle, titleSpaceMm } = resolveTableHeading(options, availableHeightMm);
  const listOptions = resolveListOptions(options);
  const { columns, fixedWidthMm, maxFlex } = resolveTableColumns(options, layout, columnWidthMm, availableWidthMm);
  if (layout === "wide") {
    availableWidthMm = columns.reduce((sum, column) => sum + column.widthMm, 0);
    checkNumber(availableWidthMm, "宽表总列宽");
    widthMm = availableWidthMm + margins.marginLeftMm + margins.marginRightMm;
    checkNumber(widthMm, "宽表总宽度");
  }

  const page: TemplatePage = { widthMm, heightMm, ...margins, components: [], ...(layout === "wide" ? { layout } : {}) };
  if (hasTitle) {
    page.components.push({
      kind: "text",
      text: options.title,
      leftMm: margins.marginLeftMm,
      topMm: margins.marginTopMm,
      widthMm: availableWidthMm,
      heightMm: titleHeightMm,
      style: { fontSize: 16, bold: true, align: "center", verticalAlign: "middle", ...options.titleStyle }
    });
  }
  page.components.push({
    align: "auto",
    headerAlign: "center",
    ...listOptions,
    kind: "list",
    ...(layout === "wide" ? { layout } : {}),
    ...(hasTitle ? { title: options.title } : {}),
    dataset,
    columns,
    leftMm: margins.marginLeftMm,
    topMm: margins.marginTopMm + titleSpaceMm,
    widthMm: layout === "wide" || maxFlex > 0 ? availableWidthMm : fixedWidthMm
  });
  return options.params === undefined ? { pages: [page] } : { params: options.params, pages: [page] };
}
