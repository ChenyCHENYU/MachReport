import type { ListColumn, ListComponent, ReportTemplate, TemplatePage } from "../layout/paginate";
import type { ComponentStyle } from "../schema/render-plan";
import { PAPER_SIZES } from "../units";
import { resolvePaper, type PageOptions, type PaperName } from "./template-builder";

/** 标准明细列：显式 widthMm 优先；其余列按 flex 分配剩余可用宽度。 */
export type TableTemplateColumn = Omit<ListColumn, "widthMm"> & {
  widthMm?: number;
  /** 自动列的宽度权重，默认 1（有 widthMm 时不参与分配）。 */
  flex?: number;
};

export type TableTemplateListOptions = Partial<
  Omit<ListComponent, "kind" | "leftMm" | "topMm" | "widthMm" | "dataset" | "columns">
>;

export interface TableTemplateOptions extends PageOptions {
  title?: string;
  /** 标题占高，默认 10mm；没有标题时不占空间。 */
  titleHeightMm?: number;
  /** 标题与表格间距，默认 4mm。 */
  titleGapMm?: number;
  titleStyle?: ComponentStyle;
  dataset?: string;
  columns: readonly TableTemplateColumn[];
  /** 默认 A4；页边距各默认 10mm。 */
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

/**
 * 创建一页标准明细模板；分页与格式化继续由 paginateTemplate 处理。
 * 固定列保持毫米宽度，自动列共享余量；全部固定列时表格宽度为列宽之和。
 */
export function createTableTemplate(options: TableTemplateOptions): ReportTemplate {
  if (!options || typeof options !== "object") {
    throw new Error("标准明细模板需要 options 对象");
  }
  if (!Array.isArray(options.columns) || options.columns.length === 0) {
    throw new Error("columns 至少需要一列");
  }
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
  const { widthMm, heightMm } = resolvePaper(paper, undefined, options.landscape);
  checkNumber(widthMm, "纸张 widthMm");
  checkNumber(heightMm, "纸张 heightMm");

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
  const availableWidthMm = widthMm - margins.marginLeftMm - margins.marginRightMm;
  const availableHeightMm = heightMm - margins.marginTopMm - margins.marginBottomMm;
  if (availableWidthMm <= 0 || availableHeightMm <= 0) {
    throw new Error("页边距占满纸张，必须保留正的可用宽度和高度");
  }

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

  let fixedWidthMm = 0;
  let maxFlex = 0;
  for (const [index, column] of options.columns.entries()) {
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
  if (fixedWidthMm > availableWidthMm) {
    throw new Error(`固定列宽 ${fixedWidthMm}mm 超出页面可用宽度 ${availableWidthMm}mm`);
  }
  const remainingWidthMm = availableWidthMm - fixedWidthMm;
  if (maxFlex > 0 && remainingWidthMm <= 0) {
    throw new Error("固定列占满页面可用宽度，自动列需要正的剩余宽度");
  }
  // 先归一化权重，避免多个合法但很大的 flex 求和溢出。
  const flexTotal = maxFlex > 0
    ? options.columns.reduce((sum, column) => sum + (column.widthMm === undefined ? (column.flex ?? 1) / maxFlex : 0), 0)
    : 0;
  const columns: ListColumn[] = options.columns.map(({ widthMm: fixed, flex: _flex, ...column }, index) => {
    const columnWidthMm = fixed ?? remainingWidthMm * ((_flex ?? 1) / maxFlex) / flexTotal;
    checkNumber(columnWidthMm, `columns[${index}] 分配后的 widthMm`);
    return { ...column, widthMm: columnWidthMm };
  });

  const page: TemplatePage = { widthMm, heightMm, ...margins, components: [] };
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
    dataset,
    columns,
    leftMm: margins.marginLeftMm,
    topMm: margins.marginTopMm + titleSpaceMm,
    widthMm: maxFlex > 0 ? availableWidthMm : fixedWidthMm
  });
  return options.params === undefined ? { pages: [page] } : { params: options.params, pages: [page] };
}
