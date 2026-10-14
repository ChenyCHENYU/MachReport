import type { ReportTemplate } from "../layout/paginate";
import { RENDER_PLAN_SCHEMA_VERSION } from "../schema/render-plan";
import { validateComponent, type ValidationError, type ValidationResult } from "../schema/validate";

/** 模板存储文档版本；与渲染计划版本独立演进。 */
export const REPORT_TEMPLATE_DOCUMENT_VERSION = "1.0" as const;

/** 可存入数据库/文件的纯 JSON 模板；数据、接口与鉴权仍由宿主提供。 */
export interface ReportTemplateDocument {
  schemaVersion: typeof REPORT_TEMPLATE_DOCUMENT_VERSION;
  id: string;
  name: string;
  /** 宿主的发布版本/乐观锁标识，不由引擎自动递增。 */
  revision?: string;
  description?: string;
  template: ReportTemplate;
}

export type ReportTemplateSummary = Omit<ReportTemplateDocument, "template">;

export interface ReportTemplateRegistry {
  /** 返回独立快照，调用方编辑不会改变目录中的已注册模板。 */
  get(id: string): ReportTemplateDocument | undefined;
  list(): ReportTemplateSummary[];
  /** 重复 ID 默认拒绝；更新必须显式 replace:true。 */
  register(document: ReportTemplateDocument, options?: { replace?: boolean }): void;
  remove(id: string): boolean;
}

export class ReportTemplateError extends Error {
  constructor(readonly errors: readonly ValidationError[]) {
    super(`模板校验失败：${errors.slice(0, 3).map((error) => `${error.path}: ${error.message}`).join("; ")}`);
    this.name = "ReportTemplateError";
  }
}

type JsonObject = Record<string, unknown>;
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const DOCUMENT_KEYS = new Set(["schemaVersion", "id", "name", "revision", "description", "template"]);
const ALIGNMENTS = new Set(["left", "center", "right", "justify"]);
const MAX_JSON_NODES = 200_000;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_CHARACTERS = 10_000_000;

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 先拒绝函数、访问器、循环、特殊原型与危险键，避免 JSON 导出时静默丢字段。 */
function validateJson(input: unknown, errors: ValidationError[]): void {
  const ancestors = new Set<object>();
  let count = 0;
  let characters = 0;
  let characterLimitReached = false;
  const visit = (value: unknown, path: string, depth: number): void => {
    if (characterLimitReached) return;
    if (++count > MAX_JSON_NODES) {
      if (count === MAX_JSON_NODES + 1) errors.push({ path, message: "模板超过 JSON 节点安全上限" });
      return;
    }
    if (depth > MAX_JSON_DEPTH) {
      errors.push({ path, message: "模板嵌套层级过深" });
      return;
    }
    if (typeof value === "string") {
      characters += value.length;
      if (characters > MAX_JSON_CHARACTERS) {
        characterLimitReached = true;
        errors.push({ path, message: "模板文本超过 1000 万字符的安全上限" });
      }
      return;
    }
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (!value || typeof value !== "object") {
      errors.push({ path, message: "模板只允许 JSON 值，不允许函数、undefined 或非有限数字" });
      return;
    }
    if (ancestors.has(value)) {
      errors.push({ path, message: "模板不能包含循环引用" });
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if ((Array.isArray(value) && prototype !== Array.prototype) || (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)) {
      errors.push({ path, message: "模板对象必须使用普通 JSON 对象原型" });
      return;
    }
    if (Array.isArray(value) && (Object.keys(value).length !== value.length || Object.keys(value).some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) {
      errors.push({ path, message: "模板数组不能包含空位或额外属性" });
      return;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      errors.push({ path, message: "模板不能包含 Symbol 键" });
      return;
    }
    ancestors.add(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && key === "length") continue;
      if (UNSAFE_KEYS.has(key)) {
        errors.push({ path: `${path}.${key}`, message: "模板不能包含可能污染原型的键" });
      } else if (descriptor.get || descriptor.set || !descriptor.enumerable) {
        errors.push({ path: `${path}.${key}`, message: "模板不能包含访问器或不可枚举字段" });
      } else visit(descriptor.value, `${path}.${key}`, depth + 1);
      if (count > MAX_JSON_NODES || characterLimitReached) break;
    }
    ancestors.delete(value);
  };
  visit(input, "$", 0);
}

function stringField(object: JsonObject, key: string, path: string, errors: ValidationError[], required = false): void {
  const value = object[key];
  if (value === undefined && !required) return;
  if (typeof value !== "string" || (required && !value.trim())) {
    errors.push({ path: `${path}.${key}`, message: required ? "应为非空字符串" : "应为字符串" });
  }
}

function numberField(object: JsonObject, key: string, path: string, errors: ValidationError[], minimum = 0, required = false): void {
  const value = object[key];
  if (value === undefined && !required) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    errors.push({ path: `${path}.${key}`, message: `应为大于等于 ${minimum} 的有限数字` });
  }
}

function booleanField(object: JsonObject, key: string, path: string, errors: ValidationError[]): void {
  if (object[key] !== undefined && typeof object[key] !== "boolean") {
    errors.push({ path: `${path}.${key}`, message: "应为布尔值" });
  }
}

function alignment(value: unknown, path: string, errors: ValidationError[], allowAuto = false): void {
  if (value !== undefined && (!ALIGNMENTS.has(value as string) && !(allowAuto && value === "auto"))) {
    errors.push({ path, message: `未知对齐方式${allowAuto ? "（支持 auto）" : ""}` });
  }
}

function validateStyle(value: unknown, path: string, errors: ValidationError[]): void {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push({ path, message: "样式应为对象" });
    return;
  }
  alignment(value.align, `${path}.align`, errors);
  if (value.verticalAlign !== undefined && !["top", "middle", "bottom"].includes(value.verticalAlign as string)) {
    errors.push({ path: `${path}.verticalAlign`, message: "未知垂直对齐方式" });
  }
  for (const key of ["fontSize", "fontSizePx", "lineWidthPt", "lineHeight"]) numberField(value, key, path, errors);
  for (const key of ["letterSpacing", "rotateDeg"]) numberField(value, key, path, errors, -Infinity);
  numberField(value, "opacity", path, errors);
  if (typeof value.opacity === "number" && value.opacity > 1) errors.push({ path: `${path}.opacity`, message: "透明度不能大于 1" });
  for (const key of ["bold", "italic", "underline", "borderTop", "borderRight", "borderBottom", "borderLeft"]) booleanField(value, key, path, errors);
  for (const key of ["fontFamily", "color", "backgroundColor", "lineColor", "borderColor"]) stringField(value, key, path, errors);
}

function validateParams(value: unknown, path: string, errors: ValidationError[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push({ path, message: "参数定义应为数组" });
    return;
  }
  const fields = new Set<string>();
  value.forEach((param, index) => {
    const here = `${path}.${index}`;
    if (!isObject(param)) { errors.push({ path: here, message: "参数定义应为对象" }); return; }
    stringField(param, "field", here, errors, true);
    if (typeof param.field === "string") {
      if (fields.has(param.field)) errors.push({ path: `${here}.field`, message: "参数名重复" });
      fields.add(param.field);
    }
    if (param.type !== undefined && !["text", "number", "date", "select"].includes(param.type as string)) {
      errors.push({ path: `${here}.type`, message: "未知参数类型" });
    }
    for (const key of ["label", "defaultValue", "placeholder"]) stringField(param, key, here, errors);
    booleanField(param, "required", here, errors);
    if (param.options !== undefined) {
      if (!Array.isArray(param.options)) errors.push({ path: `${here}.options`, message: "选项应为数组" });
      else param.options.forEach((option, optionIndex) => {
        const optionPath = `${here}.options.${optionIndex}`;
        if (!isObject(option)) errors.push({ path: optionPath, message: "选项应为对象" });
        else {
          for (const key of ["label", "value"]) if (typeof option[key] !== "string") errors.push({ path: `${optionPath}.${key}`, message: "选项标签与值应为字符串（允许空白选项）" });
        }
      });
    }
  });
}

function validateList(list: JsonObject, path: string, errors: ValidationError[]): void {
  for (const key of ["leftMm", "topMm"]) numberField(list, key, path, errors, -Infinity, true);
  numberField(list, "widthMm", path, errors, Number.MIN_VALUE, true);
  stringField(list, "dataset", path, errors, true);
  stringField(list, "title", path, errors);
  if (list.layout !== undefined && list.layout !== "page" && list.layout !== "wide") errors.push({ path: `${path}.layout`, message: "布局应为 page 或 wide" });
  if (!Array.isArray(list.columns) || list.columns.length === 0) {
    errors.push({ path: `${path}.columns`, message: "列表至少需要一列" });
  } else list.columns.forEach((column, index) => {
    const here = `${path}.columns.${index}`;
    if (!isObject(column)) { errors.push({ path: here, message: "列应为对象" }); return; }
    if (typeof column.header !== "string") errors.push({ path: `${here}.header`, message: "表头应为字符串（允许空白表头）" });
    stringField(column, "field", here, errors, true);
    numberField(column, "widthMm", here, errors, Number.MIN_VALUE, true);
    validateStyle(column.style, `${here}.style`, errors);
    validateStyle(column.headerStyle, `${here}.headerStyle`, errors);
    alignment(column.align, `${here}.align`, errors, true);
    alignment(column.headerAlign, `${here}.headerAlign`, errors);
    if (column.format !== undefined) {
      if (!isObject(column.format) || !["number", "percent", "date"].includes(column.format.kind as string)) {
        errors.push({ path: `${here}.format`, message: "未知列格式" });
      } else {
        const digits = column.format.digits;
        if (digits !== undefined && (typeof digits !== "number" || !Number.isInteger(digits) || digits < 0 || digits > 100)) {
          errors.push({ path: `${here}.format.digits`, message: "小数位应为 0–100 的整数" });
        }
        booleanField(column.format, "thousands", `${here}.format`, errors);
        stringField(column.format, "pattern", `${here}.format`, errors);
      }
    }
    if (column.rules !== undefined) {
      if (!Array.isArray(column.rules)) errors.push({ path: `${here}.rules`, message: "条件格式应为数组" });
      else column.rules.forEach((rule, ri) => {
        const rulePath = `${here}.rules.${ri}`;
        if (!isObject(rule) || !isObject(rule.when)) { errors.push({ path: rulePath, message: "条件格式缺少 when 对象" }); return; }
        stringField(rule.when, "field", `${rulePath}.when`, errors, true);
        if (![">", ">=", "<", "<=", "==", "!="].includes(rule.when.op as string)) errors.push({ path: `${rulePath}.when.op`, message: "未知条件运算符" });
        if (typeof rule.when.value !== "number" && typeof rule.when.value !== "string") errors.push({ path: `${rulePath}.when.value`, message: "条件值应为数字或字符串" });
        validateStyle(rule.style, `${rulePath}.style`, errors);
      });
    }
  });
  for (const key of ["fontSizePt", "rowHeightMm"]) numberField(list, key, path, errors, Number.MIN_VALUE);
  numberField(list, "paddingMm", path, errors);
  for (const key of ["headerBold", "headerEveryPage", "border"]) booleanField(list, key, path, errors);
  stringField(list, "headerBackgroundColor", path, errors);
  alignment(list.align, `${path}.align`, errors, true);
  alignment(list.headerAlign, `${path}.headerAlign`, errors);
  validateStyle(list.headerStyle, `${path}.headerStyle`, errors);
  if (list.groupBy !== undefined) {
    if (!isObject(list.groupBy)) errors.push({ path: `${path}.groupBy`, message: "分组应为对象" });
    else {
      stringField(list.groupBy, "field", `${path}.groupBy`, errors, true);
      for (const key of ["headerTemplate", "subtotalLabel"]) stringField(list.groupBy, key, `${path}.groupBy`, errors);
      for (const key of ["headerStyle", "subtotalStyle"]) validateStyle(list.groupBy[key], `${path}.groupBy.${key}`, errors);
      booleanField(list.groupBy, "keepWithNext", `${path}.groupBy`, errors);
      if (list.groupBy.subtotal !== undefined && (!Array.isArray(list.groupBy.subtotal) || list.groupBy.subtotal.some((field) => typeof field !== "string"))) {
        errors.push({ path: `${path}.groupBy.subtotal`, message: "小计字段应为字符串数组" });
      }
    }
  }
  if (list.grandTotal !== undefined && typeof list.grandTotal !== "boolean") {
    if (!isObject(list.grandTotal)) errors.push({ path: `${path}.grandTotal`, message: "合计应为布尔值或对象" });
    else {
      stringField(list.grandTotal, "label", `${path}.grandTotal`, errors);
      validateStyle(list.grandTotal.style, `${path}.grandTotal.style`, errors);
      if (list.grandTotal.fields !== undefined && (!Array.isArray(list.grandTotal.fields) || list.grandTotal.fields.some((field) => typeof field !== "string"))) {
        errors.push({ path: `${path}.grandTotal.fields`, message: "合计字段应为字符串数组" });
      }
    }
  }
}

function validateStaticFields(component: JsonObject, path: string, errors: ValidationError[]): void {
  validateStyle(component.style, `${path}.style`, errors);
  for (const key of ["text", "rawText", "imageData", "fallbackText", "nid", "rkey"]) stringField(component, key, path, errors);
  if (component.lines !== undefined && (!Array.isArray(component.lines) || component.lines.some((line) => typeof line !== "string"))) errors.push({ path: `${path}.lines`, message: "文本行应为字符串数组" });
  if (Array.isArray(component.richParagraphs)) component.richParagraphs.forEach((paragraph, index) => {
    if (!isObject(paragraph)) return;
    const here = `${path}.richParagraphs.${index}`;
    alignment(paragraph.align, `${here}.align`, errors);
    for (const key of ["lineHeight", "spaceBeforeMm", "spaceAfterMm", "indentMm"]) numberField(paragraph, key, here, errors);
    if (Array.isArray(paragraph.segments)) paragraph.segments.forEach((segment, si) => {
      const segmentPath = `${here}.segments.${si}`;
      if (!isObject(segment)) { errors.push({ path: segmentPath, message: "富文本片段应为对象" }); return; }
      if (segment.kind !== undefined && segment.kind !== "text" && segment.kind !== "field") errors.push({ path: `${segmentPath}.kind`, message: "未知富文本片段类型" });
      for (const key of ["text", "field"]) stringField(segment, key, segmentPath, errors);
      validateStyle(segment.style, `${segmentPath}.style`, errors);
    });
  });
  if (!isObject(component.grid)) return;
  const grid = component.grid;
  numberField(grid, "gapMm", `${path}.grid`, errors);
  for (const key of ["colWidthsMm", "rowHeightsMm"]) {
    const values = grid[key];
    if (values !== undefined && (!Array.isArray(values) || values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0))) errors.push({ path: `${path}.grid.${key}`, message: "网格尺寸应为有限非负数字数组" });
  }
  if (Array.isArray(grid.cells)) grid.cells.forEach((row, ri) => {
    if (!Array.isArray(row)) return;
    row.forEach((cell, ci) => {
      const here = `${path}.grid.cells.${ri}.${ci}`;
      if (cell === null) return;
      if (!isObject(cell)) { errors.push({ path: here, message: "网格单元格应为对象或 null" }); return; }
      for (const key of ["text", "rawText", "numberFormat"]) stringField(cell, key, here, errors);
      for (const key of ["colSpan", "rowSpan"]) {
        const span = cell[key];
        if (span !== undefined && (typeof span !== "number" || !Number.isInteger(span) || span <= 0)) errors.push({ path: `${here}.${key}`, message: "跨度应为正整数" });
      }
      if (cell.value !== undefined && cell.value !== null && !["string", "number", "boolean"].includes(typeof cell.value)) errors.push({ path: `${here}.value`, message: "Excel 原始值应为字符串、数字、布尔值或 null" });
      validateStyle(cell.style, `${here}.style`, errors);
      if (cell.children !== undefined) {
        if (!Array.isArray(cell.children)) errors.push({ path: `${here}.children`, message: "嵌套组件应为数组" });
        else cell.children.forEach((child, index) => { if (isObject(child)) validateStaticFields(child, `${here}.children.${index}`, errors); });
      }
    });
  });
}

/** 对入库/导入模板做声明式校验，不执行分页或数据请求。 */
export function validateReportTemplate(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  validateJson(input, errors);
  if (errors.length) return { ok: false, errors, warnings };
  if (!isObject(input)) errors.push({ path: "$", message: "模板应为对象" });
  else {
    if (input.schemaVersion !== undefined && input.schemaVersion !== RENDER_PLAN_SCHEMA_VERSION) {
      errors.push({ path: "$.schemaVersion", message: "不支持的模板 schemaVersion" });
    }
    validateParams(input.params, "$.params", errors);
    if (!Array.isArray(input.pages) || input.pages.length === 0) errors.push({ path: "$.pages", message: "模板至少需要一页" });
    else input.pages.forEach((page, index) => {
      const path = `$.pages.${index}`;
      if (!isObject(page)) { errors.push({ path, message: "页应为对象" }); return; }
      numberField(page, "widthMm", path, errors, Number.MIN_VALUE, true);
      numberField(page, "heightMm", path, errors, Number.MIN_VALUE, true);
      if (page.layout !== undefined && page.layout !== "page" && page.layout !== "wide") errors.push({ path: `${path}.layout`, message: "布局应为 page 或 wide" });
      if (typeof page.heightMm === "number" && page.heightMm >= 5000) errors.push({ path: `${path}.heightMm`, message: "页高应小于 5000mm" });
      for (const key of ["marginTopMm", "marginBottomMm", "marginLeftMm", "marginRightMm"]) numberField(page, key, path, errors);
      if (typeof page.widthMm === "number" && Number(page.marginLeftMm ?? 0) + Number(page.marginRightMm ?? 0) >= page.widthMm) errors.push({ path, message: "横向页边距占满页面" });
      if (typeof page.heightMm === "number" && Number(page.marginTopMm ?? 0) + Number(page.marginBottomMm ?? 0) >= page.heightMm) errors.push({ path, message: "纵向页边距占满页面" });
      if (!Array.isArray(page.components)) errors.push({ path: `${path}.components`, message: "组件应为数组" });
      else page.components.forEach((component, ci) => {
        const here = `${path}.components.${ci}`;
        if (isObject(component) && component.kind === "list") validateList(component, here, errors);
        else { validateComponent(component, here, errors, warnings); if (isObject(component)) validateStaticFields(component, here, errors); }
      });
    });
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function validateReportTemplateDocument(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  validateJson(input, errors);
  if (errors.length) return { ok: false, errors, warnings };
  if (!isObject(input)) errors.push({ path: "$", message: "模板文档应为对象" });
  else {
    for (const key of Object.keys(input)) {
      if (!DOCUMENT_KEYS.has(key)) errors.push({ path: `$.${key}`, message: "模板文档存在未知字段；只保存模板与描述，不保存取数或业务数据" });
    }
    if (input.schemaVersion !== REPORT_TEMPLATE_DOCUMENT_VERSION) errors.push({ path: "$.schemaVersion", message: "不支持的模板文档版本" });
    for (const key of ["id", "name"]) stringField(input, key, "$", errors, true);
    for (const key of ["revision", "description"]) stringField(input, key, "$", errors);
    const result = validateReportTemplate(input.template);
    errors.push(...result.errors.map((error) => ({ ...error, path: `$.template${error.path.slice(1)}` })));
    warnings.push(...result.warnings.map((warning) => ({ ...warning, path: `$.template${warning.path.slice(1)}` })));
  }
  return { ok: errors.length === 0, errors, warnings };
}

function assertDocument(document: unknown): asserts document is ReportTemplateDocument {
  const result = validateReportTemplateDocument(document);
  if (!result.ok) throw new ReportTemplateError(result.errors);
}

/** 创建带文档版本的模板快照，使用侧无需记忆 schemaVersion 常量。 */
export function defineReportTemplate(document: Omit<ReportTemplateDocument, "schemaVersion"> & { schemaVersion?: typeof REPORT_TEMPLATE_DOCUMENT_VERSION }): ReportTemplateDocument {
  const errors: ValidationError[] = [];
  validateJson(document, errors);
  if (errors.length) throw new ReportTemplateError(errors);
  const result = { ...document, schemaVersion: document.schemaVersion ?? REPORT_TEMPLATE_DOCUMENT_VERSION };
  assertDocument(result);
  return clone(result);
}

/** 校验文件 JSON 文本或接口返回的未知对象，返回独立模板快照。 */
export function parseReportTemplate(input: unknown): ReportTemplateDocument {
  let document: unknown = input;
  if (typeof input === "string") {
    if (input.length > MAX_JSON_CHARACTERS) {
      throw new ReportTemplateError([{ path: "$", message: "模板 JSON 超过 1000 万字符的导出/导入上限" }]);
    }
    try { document = JSON.parse(input); }
    catch { throw new ReportTemplateError([{ path: "$", message: "模板 JSON 语法无效" }]); }
  }
  assertDocument(document);
  return clone(document);
}

/** 格式化输出已校验的纯模板 JSON，不静默丢弃函数或非法数字。 */
export function serializeReportTemplate(document: ReportTemplateDocument): string {
  assertDocument(document);
  const json = JSON.stringify(document, null, 2);
  if (json.length > MAX_JSON_CHARACTERS) throw new ReportTemplateError([{ path: "$", message: "模板 JSON 超过 1000 万字符的导出/导入上限" }]);
  return json;
}

function clone(document: ReportTemplateDocument): ReportTemplateDocument {
  return JSON.parse(JSON.stringify(document)) as ReportTemplateDocument;
}

/** 存储无关的模板目录；后台 CRUD、权限、发布审批与持久化由宿主接入。 */
export function createTemplateRegistry(documents: readonly ReportTemplateDocument[] = []): ReportTemplateRegistry {
  const entries = new Map<string, ReportTemplateDocument>();
  const registry: ReportTemplateRegistry = {
    get: (id) => { const document = entries.get(id); return document ? clone(document) : undefined; },
    list: () => Array.from(entries.values(), ({ template: _template, ...summary }) => ({ ...summary })),
    register: (document, options = {}) => {
      assertDocument(document);
      if (entries.has(document.id) && !options.replace) throw new ReportTemplateError([{ path: "$.id", message: `模板 ID ${document.id} 已注册；更新需显式 replace:true` }]);
      entries.set(document.id, clone(document));
    },
    remove: (id) => entries.delete(id)
  };
  for (const document of documents) registry.register(document);
  return registry;
}
