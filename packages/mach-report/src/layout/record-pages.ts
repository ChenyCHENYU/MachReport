import { resolveFontSize, resolveLineHeight } from "../render/style";
import type { ReportTemplateRepeat } from "../schema/component-binding";
import type { PlanComponent } from "../schema/render-plan";
import { validateTemplateRepeat } from "../source/template-repeat-validation";
import type { ValidationError } from "../schema/validate";
import type { DatasetRows, PaginateOptions, ReportTemplate, TemplatePage } from "./paginate";
import { heuristicMeasurer } from "./textwrap";
import { createRecordTextWrapper, type RecordTextWrapper } from "./record-pages-text";
import { isLabelImageData, readRecordScalar as scalar, ReportBindingError, resolveComponentBinding } from "./record-bindings";
import { PaginatePageLimitError } from "./pagination-errors";
export { ReportBindingError } from "./record-bindings";

/** Labels are bounded even when a host omits its normal report page budget. */
export const DEFAULT_LABEL_PAGE_LIMIT = 10_000;
const MAX_LABEL_LAYOUT_ITEMS = 250_000;
interface RecordContext {
  row: Record<string, unknown>;
  rowIndex: number;
  dataset: string;
  options: PaginateOptions;
  wrapText: RecordTextWrapper;
}
function active(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("标签生成已取消", "AbortError");
}
function copiesFor(repeat: ReportTemplateRepeat, row: Record<string, unknown>, context: Pick<RecordContext, "rowIndex" | "dataset">): number {
  const value = typeof repeat.copies === "object" ? scalar(row, repeat.copies.field, context) : repeat.copies ?? 1;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 1000) throw new ReportBindingError(`$.datasets.${context.dataset}[${context.rowIndex}]`, "每条记录复制数必须是 1..1000 的数值型整数", context.rowIndex, typeof repeat.copies === "object" ? repeat.copies.field : undefined);
  return value;
}
function recordKey(repeat: ReportTemplateRepeat, row: Record<string, unknown>, context: Pick<RecordContext, "rowIndex" | "dataset">): string | number | undefined {
  if (repeat.rowKey === undefined) return;
  const value = scalar(row, repeat.rowKey, context);
  if (typeof value === "string" && value.trim() || typeof value === "number" && Number.isFinite(value)) return value as string | number;
  throw new ReportBindingError(`$.datasets.${context.dataset}[${context.rowIndex}].${repeat.rowKey}`, "业务主键必须是非空字符串或有限数字", context.rowIndex, repeat.rowKey);
}
function templateLayoutItems(template: ReportTemplate): number {
  // Every row and slot allocates layout memory, even for null/empty cells; nested children recurse.
  const count = (component: PlanComponent): number => 1 + (component.grid?.cells.reduce((sum, row) => sum + 1 + row.length + row.reduce((total, cell) => total + (cell?.children?.reduce((value, child) => value + count(child), 0) ?? 0), 0), 0) ?? 0);
  return template.pages.reduce((sum, page) => sum + page.components.reduce((total, component) => total + count(component as PlanComponent), 0), 0);
}
function repeatRows(template: ReportTemplate, datasets: DatasetRows, options: PaginateOptions): Record<string, unknown>[] {
  const repeat = template.repeat!;
  const rows = Object.prototype.hasOwnProperty.call(datasets, repeat.dataset) ? datasets[repeat.dataset] : undefined;
  if (!Array.isArray(rows)) throw new ReportBindingError(`$.datasets.${repeat.dataset}`, "逐记录标签数据集缺失，应提供对象数组（允许空数组）");
  const keys = new Set<string>(), limit = options.maxPages ?? DEFAULT_LABEL_PAGE_LIMIT;
  const layoutItemsPerCopy = templateLayoutItems(template);
  let pages = 0, layoutItems = 0;
  for (const [rowIndex, row] of rows.entries()) {
    active(options.signal);
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new ReportBindingError(`$.datasets.${repeat.dataset}[${rowIndex}]`, "标签记录应为对象", rowIndex);
    const context = { rowIndex, dataset: repeat.dataset }, key = recordKey(repeat, row, context);
    if (key !== undefined) {
      const identity = JSON.stringify([typeof key, key]);
      if (keys.has(identity)) throw new ReportBindingError(`$.datasets.${repeat.dataset}[${rowIndex}].${repeat.rowKey}`, "业务主键重复；请先确认记录来源，避免重复打印标签", rowIndex, repeat.rowKey);
      keys.add(identity);
    }
    const copies = copiesFor(repeat, row, context);
    pages += copies * template.pages.length;
    layoutItems += copies * layoutItemsPerCopy;
    if (pages > limit) throw new PaginatePageLimitError(limit, pages);
    if (layoutItems > MAX_LABEL_LAYOUT_ITEMS) throw new ReportBindingError("$.repeat", `标签组件总量（含网格行、槽位及嵌套组件）超过安全预算 ${MAX_LABEL_LAYOUT_ITEMS}，请分批生成`, rowIndex);
  }
  return rows;
}
function bindValue(component: PlanComponent, context: RecordContext, path: string): PlanComponent | undefined {
  if (!component.binding) return component;
  const { binding, ...next } = component;
  const text = resolveComponentBinding(binding, context.row, context);
  if (component.kind === "image") {
    if (!text) return;
    if (!isLabelImageData(text)) throw new ReportBindingError(`${path}.binding`, "图片字段只接受 PNG/JPEG base64 data URL；业务 URL 应由宿主安全加载后转换", context.rowIndex, binding.field);
    return { ...next, imageData: text };
  }
  if (component.kind === "barcode" || component.kind === "qrcode") {
    delete next.imageData;
    return { ...next, code: { ...next.code, value: text }, fallbackText: text };
  }
  delete next.lines;
  delete next.richParagraphs;
  return { ...next, text };
}
function textLayout(component: PlanComponent, context: RecordContext, path: string): PlanComponent {
  if (component.kind !== "text" || component.grid || component.richParagraphs?.length) return component;
  const style = component.style ?? {}, fontSizePt = resolveFontSize(style).fontSizePt;
  const text = component.text ?? component.lines?.join("\n") ?? "";
  if (text.length > 16_384) throw new ReportBindingError(path, "标签文本超过 16384 字符预算，请缩小字段内容", context.rowIndex);
  const lines = context.wrapText(text, component.widthMm, { fontSizePt, bold: style.bold, italic: style.italic, fontFamily: style.fontFamily, letterSpacingPt: style.letterSpacing }, context.options.measurer ?? heuristicMeasurer);
  const height = lines.length * fontSizePt * resolveLineHeight(style) * 25.4 / 72;
  if (height > component.heightMm + 0.05) throw new ReportBindingError(path, `标签文字需要约 ${height.toFixed(2)}mm 高，超出 ${component.heightMm}mm；请增大文本区域、减少内容或调整字号`, context.rowIndex, component.binding?.field);
  return { ...component, lines };
}
function bindComponent(component: PlanComponent, context: RecordContext, path: string): PlanComponent | undefined {
  active(context.options.signal);
  const next = bindValue(component, context, path);
  if (!next) return;
  let grid = next.grid;
  if (grid) grid = { ...grid, cells: grid.cells.map((row, ri) => row.map((cell, ci) => cell?.children?.length ? { ...cell, children: cell.children.flatMap((child, ki) => {
    const bound = bindComponent(child, context, `${path}.grid.cells.${ri}.${ci}.children.${ki}`); return bound ? [bound] : [];
  }) } : cell)) };
  return textLayout(grid === next.grid ? next : { ...next, grid }, context, path);
}
function boundPage(page: TemplatePage, pageIndex: number, context: RecordContext, copyIndex: number, copyCount: number, rowKey?: string | number): TemplatePage {
  return {
    ...page,
    components: page.components.flatMap((component, ci) => {
      const bound = bindComponent(component as PlanComponent, context, `$.pages.${pageIndex}.components.${ci}`);
      return bound ? [{ ...bound, meta: { ...bound.meta, labelSource: { pageIndex, componentIndex: ci } } }] : [];
    }),
    meta: { ...page.meta, record: { dataset: context.dataset, rowIndex: context.rowIndex, ...(rowKey === undefined ? {} : { rowKey }), copyIndex, copyCount, templatePageIndex: pageIndex } }
  };
}
/** Pure, lazy expansion; the full page budget is checked before allocating the first label. */
export function* repeatTemplatePages(template: ReportTemplate, datasets: DatasetRows, options: PaginateOptions): Generator<{ page: TemplatePage; pageIndex: number }> {
  const errors: ValidationError[] = [];
  validateTemplateRepeat(template as unknown as Record<string, unknown>, errors);
  if (errors.length) throw new ReportBindingError(errors[0]!.path, errors[0]!.message);
  if (!template.repeat) { for (const [pageIndex, page] of template.pages.entries()) yield { page, pageIndex }; return; }
  const repeat = template.repeat, rows = repeatRows(template, datasets, options);
  const wrapText = createRecordTextWrapper();
  for (const [rowIndex, row] of rows.entries()) {
    const context: RecordContext = { row, rowIndex, dataset: repeat.dataset, options, wrapText }, copies = copiesFor(repeat, row, context), key = recordKey(repeat, row, context);
    for (let copyIndex = 0; copyIndex < copies; copyIndex++) for (const [pageIndex, page] of template.pages.entries()) {
      active(options.signal);
      yield { page: boundPage(page, pageIndex, context, copyIndex, copies, key), pageIndex };
    }
  }
}
