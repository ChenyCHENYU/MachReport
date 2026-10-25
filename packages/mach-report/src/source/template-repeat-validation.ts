import type { ValidationError } from "../schema/validate";

type ObjectValue = Record<string, unknown>;
const UNSAFE_FIELDS = new Set(["__proto__", "prototype", "constructor"]);
function object(value: unknown): value is ObjectValue { return !!value && typeof value === "object" && !Array.isArray(value); }
function field(value: unknown): value is string { return typeof value === "string" && !!value.trim() && !UNSAFE_FIELDS.has(value); }
function exactKeys(value: ObjectValue, allowed: readonly string[], path: string, errors: ValidationError[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push({ path: `${path}.${key}`, message: "存在未知配置字段" });
}
function validateFormat(value: unknown, path: string, errors: ValidationError[]): void {
  if (value === undefined) return;
  if (!object(value) || !["number", "percent", "date"].includes(String(value.kind))) { errors.push({ path, message: "绑定格式应为 number、percent 或 date" }); return; }
  exactKeys(value, value.kind === "date" ? ["kind", "pattern"] : value.kind === "number" ? ["kind", "digits", "thousands"] : ["kind", "digits"], path, errors);
  if (value.digits !== undefined && (!Number.isInteger(value.digits) || Number(value.digits) < 0 || Number(value.digits) > 100)) errors.push({ path: `${path}.digits`, message: "精度应为 0..100 整数" });
  if (value.thousands !== undefined && typeof value.thousands !== "boolean") errors.push({ path: `${path}.thousands`, message: "千分位开关应为布尔值" });
  if (value.pattern !== undefined && typeof value.pattern !== "string") errors.push({ path: `${path}.pattern`, message: "日期格式应为字符串" });
}
export function validateComponentBinding(component: ObjectValue, path: string, errors: ValidationError[]): void {
  const binding = component.binding;
  if (binding === undefined) return;
  const here = `${path}.binding`;
  if (!object(binding)) { errors.push({ path: here, message: "字段绑定应为对象" }); return; }
  if (!["text", "image", "barcode", "qrcode"].includes(String(component.kind)) || component.grid !== undefined) errors.push({ path: here, message: "绑定仅支持独立文本、图片、条码与二维码组件" });
  exactKeys(binding, ["field", "format", "prefix", "suffix", "emptyText"], here, errors);
  if (!field(binding.field)) errors.push({ path: `${here}.field`, message: "绑定字段应为安全的非空字段名（按字面读取自有字段）" });
  for (const key of ["prefix", "suffix", "emptyText"]) if (binding[key] !== undefined && typeof binding[key] !== "string") errors.push({ path: `${here}.${key}`, message: "应为字符串" });
  validateFormat(binding.format, `${here}.format`, errors);
  if (component.kind === "image" && ["format", "prefix", "suffix"].some(key => binding[key] !== undefined)) errors.push({ path: here, message: "图片绑定直接读取 PNG/JPEG data URL，不支持文本格式或前后缀" });
}
function repeatConfig(value: unknown, errors: ValidationError[]): void {
  if (!object(value)) { errors.push({ path: "$.repeat", message: "逐记录配置应为对象" }); return; }
  exactKeys(value, ["dataset", "rowKey", "copies"], "$.repeat", errors);
  if (!field(value.dataset)) errors.push({ path: "$.repeat.dataset", message: "数据集应为安全的非空名称" });
  if (value.rowKey !== undefined && !field(value.rowKey)) errors.push({ path: "$.repeat.rowKey", message: "业务主键应为安全的非空字段名" });
  const copies = value.copies;
  if (copies === undefined) return;
  if (object(copies)) {
    exactKeys(copies, ["field"], "$.repeat.copies", errors);
    if (!field(copies.field)) errors.push({ path: "$.repeat.copies.field", message: "复制数字段应为安全的非空字段名" });
  } else if (!Number.isSafeInteger(copies) || Number(copies) < 1 || Number(copies) > 1000) errors.push({ path: "$.repeat.copies", message: "每条记录复制数应为 1..1000 整数" });
}
function componentReferences(value: unknown, path: string, repeated: boolean, errors: ValidationError[]): void {
  if (!object(value)) return;
  validateComponentBinding(value, path, errors);
  if (value.binding !== undefined && !repeated) errors.push({ path: `${path}.binding`, message: "字段绑定需要模板 repeat 数据集；普通报表请使用列表字段" });
  if (repeated && value.kind === "list") errors.push({ path, message: "逐记录标签使用固定组件；动态列表请使用普通报表模板" });
  if (value.chartBinding !== undefined && (repeated || path.includes(".children."))) errors.push({ path: `${path}.chartBinding`, message: "数据图表应放在普通报表的页面或流式分区，不放在逐记录标签或嵌套单元格内" });
  const grid = value.grid;
  if (object(grid) && Array.isArray(grid.cells)) grid.cells.forEach((row, ri) => {
    if (!Array.isArray(row)) return;
    row.forEach((cell, ci) => { if (object(cell) && Array.isArray(cell.children)) cell.children.forEach((child, ki) => componentReferences(child, `${path}.grid.cells.${ri}.${ci}.children.${ki}`, repeated, errors)); });
  });
}
/** Extra label validation stays separate from the ordinary list/template validator. */
export function validateTemplateRepeat(template: ObjectValue, errors: ValidationError[]): void {
  const repeated = template.repeat !== undefined;
  if (repeated) repeatConfig(template.repeat, errors);
  if (!Array.isArray(template.pages)) return;
  template.pages.forEach((page, pi) => {
    if (!object(page)) return;
    const path = `$.pages.${pi}`;
    if (repeated && (page.layout === "wide" || page.flow !== undefined)) errors.push({ path, message: "逐记录标签仅支持固定尺寸页面，不支持宽表或流式分区" });
    if (!Array.isArray(page.components)) return;
    page.components.forEach((component, ci) => {
      const here = `${path}.components.${ci}`;
      componentReferences(component, here, repeated, errors);
      if (!repeated || !object(component)) return;
      const { leftMm, topMm, widthMm, heightMm } = component;
      if ([leftMm, topMm, widthMm, heightMm, page.widthMm, page.heightMm].every(item => typeof item === "number" && Number.isFinite(item)) && (Number(leftMm) < 0 || Number(topMm) < 0 || Number(leftMm) + Number(widthMm) > Number(page.widthMm) + 0.001 || Number(topMm) + Number(heightMm) > Number(page.heightMm) + 0.001)) errors.push({ path: here, message: "标签组件超出纸张边界，请调整位置或尺寸" });
    });
  });
}
