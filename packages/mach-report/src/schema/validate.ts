import { componentTreeIssue, renderTreeIssue } from "./component-tree";
import type { PlanComponent, PlanPage } from "./render-plan";
import { validateBusinessSource, validateGridCellEditingMetadata } from "./cell-edit-validation";
import { codeOptionIssues } from "./code-options";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

const KNOWN_KINDS = new Set([
  "text",
  "image",
  "barcode",
  "qrcode",
  "chart",
  "line",
  "rect",
  "ellipse"
]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.slice(0, 120));
  if (["number", "boolean", "undefined"].includes(typeof value)) return String(value);
  return `[${typeof value}]`;
}
function checkNumber(obj: Record<string, unknown>, key: string, path: string, errors: ValidationError[]): void {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push({ path: `${path}.${key}`, message: `应为有限数字，实际 ${describeValue(v)}` });
  }
}

function validateTableSource(table: unknown, path: string, errors: ValidationError[]): void {
  if (table !== undefined) {
    const tablePath = `${path}.table`;
    if (!isObj(table)) errors.push({ path: tablePath, message: "逻辑表来源应为对象" });
    else {
      validateBusinessSource(table["source"], `${tablePath}.source`, errors);
      if (typeof table["id"] !== "string" || !table["id"].trim()) errors.push({ path: `${tablePath}.id`, message: "逻辑表 ID 应为非空字符串" });
      const role = table["role"];
      if (!["header", "body", "group-header", "subtotal", "grand-total"].includes(role as string)) errors.push({ path: `${tablePath}.role`, message: "未知逻辑表行角色" });
      const rowIndex = table["rowIndex"];
      if (typeof rowIndex !== "number" || !Number.isInteger(rowIndex) || (role === "header" ? rowIndex !== -1 : rowIndex < 0)) errors.push({ path: `${tablePath}.rowIndex`, message: "表头索引应为 -1，内容行索引应为非负整数" });
      if (!Array.isArray(table["columnKeys"]) || table["columnKeys"].some((key) => typeof key !== "string")) errors.push({ path: `${tablePath}.columnKeys`, message: "逻辑列字段应为字符串数组" });
      if (table["layout"] !== undefined && table["layout"] !== "page" && table["layout"] !== "wide") errors.push({ path: `${tablePath}.layout`, message: "布局应为 page 或 wide" });
      if (table["title"] !== undefined && typeof table["title"] !== "string") errors.push({ path: `${tablePath}.title`, message: "逻辑表名称应为字符串" });
    }
  }
}

function validateGrid(grid: unknown, path: string, errors: ValidationError[], warnings: ValidationError[]): void {
  if (grid !== undefined) {
    if (!isObj(grid) || !Array.isArray(grid["cells"])) {
      errors.push({ path: `${path}.grid.cells`, message: "grid.cells 应为二维数组" });
    } else {
      const padding = grid["paddingMm"];
      if (padding !== undefined && (typeof padding !== "number" || !Number.isFinite(padding) || padding < 0)) errors.push({ path: `${path}.grid.paddingMm`, message: "单元格内距应为有限非负数" });
      (grid["cells"] as unknown[]).forEach((row, ri) => {
        if (!Array.isArray(row)) {
          errors.push({ path: `${path}.grid.cells.${ri}`, message: "行应为数组" });
          return;
        }
        row.forEach((cell, ci) => {
          if (cell === undefined || cell === null) return;
          const here = `${path}.grid.cells.${ri}.${ci}`;
          if (!isObj(cell)) {
            errors.push({ path: here, message: "网格单元格应为对象或 null" });
            return;
          }
          validateGridCellEditingMetadata(cell, here, errors);
          validateRichText(cell["richParagraphs"], here, errors);
          if (Array.isArray(cell["children"])) {
            (cell["children"] as unknown[]).forEach((child, ki) => {
              validateComponentFields(child, `${path}.grid.cells.${ri}.${ci}.children.${ki}`, errors, warnings);
            });
          }
        });
      });
    }
  }
}

function richEnum(value: unknown, allowed: string[], path: string, errors: ValidationError[]): void {
  if (value !== undefined && !allowed.includes(value as string)) errors.push({ path, message: "未知富文本属性值" });
}
function richNumbers(value: Record<string, unknown>, keys: string[], path: string, errors: ValidationError[], minimum = 0): void {
  for (const key of keys) {
    const number = value[key];
    if (number !== undefined && (typeof number !== "number" || !Number.isFinite(number) || number < minimum)) errors.push({ path: `${path}.${key}`, message: "富文本数值应为范围内有限数字" });
  }
}
function validateRichStyle(value: unknown, path: string, errors: ValidationError[]): void {
  if (value === undefined) return;
  if (!isObj(value)) { errors.push({ path, message: "富文本样式应为对象" }); return; }
  for (const key of ["fontFamily", "color", "backgroundColor", "lineColor", "borderColor"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") errors.push({ path: `${path}.${key}`, message: "富文本样式应为字符串" });
  }
  for (const key of ["bold", "italic", "underline", "borderTop", "borderRight", "borderBottom", "borderLeft"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") errors.push({ path: `${path}.${key}`, message: "富文本样式应为布尔值" });
  }
  richNumbers(value, ["fontSize", "fontSizePx", "lineWidthPt", "lineHeight", "opacity"], path, errors);
  richNumbers(value, ["letterSpacing", "rotateDeg"], path, errors, -Infinity);
  if (typeof value.opacity === "number" && value.opacity > 1) errors.push({ path: `${path}.opacity`, message: "透明度不能大于1" });
  richEnum(value.align, ["left", "center", "right", "justify"], `${path}.align`, errors);
  richEnum(value.verticalAlign, ["top", "middle", "bottom"], `${path}.verticalAlign`, errors);
}
function validateRichSegment(value: unknown, path: string, errors: ValidationError[]): void {
  if (!isObj(value)) { errors.push({ path, message: "富文本片段应为对象" }); return; }
  richEnum(value.kind, ["text", "field"], `${path}.kind`, errors);
  for (const key of ["text", "field"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") errors.push({ path: `${path}.${key}`, message: "富文本内容应为字符串" });
  }
  validateRichStyle(value.style, `${path}.style`, errors);
}
function validateRichText(rich: unknown, path: string, errors: ValidationError[]): void {
  if (rich === undefined) return;
  if (!Array.isArray(rich)) { errors.push({ path: `${path}.richParagraphs`, message: "richParagraphs 应为数组" }); return; }
  rich.forEach((para: unknown, index) => {
    const here = `${path}.richParagraphs.${index}`;
    if (!isObj(para) || !Array.isArray(para.segments)) { errors.push({ path: here, message: "段落缺少 segments 数组" }); return; }
    richEnum(para.align, ["left", "center", "right", "justify"], `${here}.align`, errors);
    richNumbers(para, ["lineHeight", "spaceBeforeMm", "spaceAfterMm", "indentMm"], here, errors);
    para.segments.forEach((segment: unknown, segmentIndex) => validateRichSegment(segment, `${here}.segments.${segmentIndex}`, errors));
  });
}

export function validateComponent(comp: unknown, path: string, errors: ValidationError[], warnings: ValidationError[] = []): void {
  const issue = componentTreeIssue([comp], path);
  if (issue) { errors.push(issue); return; }
  validateComponentFields(comp, path, errors, warnings);
}

function validateComponentFields(
  comp: unknown,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[] = []
): void {
  if (!isObj(comp)) {
    errors.push({ path, message: "组件应为对象" });
    return;
  }
  const kind = comp["kind"];
  if (typeof kind !== "string") {
    errors.push({ path: `${path}.kind`, message: `组件缺少 kind 字符串` });
  } else if (!KNOWN_KINDS.has(kind)) {
    warnings.push({
      path: `${path}.kind`,
      message: `未知组件类型 ${describeValue(kind)}，将以兜底方式渲染`
    });
  }
  for (const key of ["leftMm", "topMm", "widthMm", "heightMm"]) {
    checkNumber(comp, key, path, errors);
  }
  if (typeof comp["leftMm"] === "number" && comp["leftMm"] < -100) {
    errors.push({ path: `${path}.leftMm`, message: "几何数值异常（leftMm<-100）" });
  }
  for (const key of ["widthMm", "heightMm"]) {
    if (typeof comp[key] === "number" && comp[key] < 0) {
      errors.push({ path: `${path}.${key}`, message: "组件尺寸不能为负数" });
    }
  }
  validateTableSource(comp["table"], path, errors);
  validateCodeOptions(comp["code"], kind, path, errors);
  if (comp["pageAnchor"] !== undefined && !["header", "footer"].includes(comp["pageAnchor"] as string)) errors.push({ path: `${path}.pageAnchor`, message: "页面锚点应为 header 或 footer" });
  if (comp["lineDirection"] !== undefined && !["down", "up"].includes(comp["lineDirection"] as string)) errors.push({ path: `${path}.lineDirection`, message: "线段方向应为 down 或 up" });
  validateGrid(comp["grid"], path, errors, warnings);
  validateRichText(comp["richParagraphs"], path, errors);
}

function validateCodeOptions(value: unknown, kind: unknown, path: string, errors: ValidationError[]): void {
  if (value === undefined) return;
  for (const issue of codeOptionIssues(value, kind as string)) errors.push({ path: `${path}.code${issue.path ? `.${issue.path}` : ""}`, message: issue.message });
}

function validateResolvedBinding(comp: unknown, path: string, errors: ValidationError[]): void {
  if (!isObj(comp)) return;
  if (comp["binding"] !== undefined) errors.push({ path: `${path}.binding`, message: "渲染计划不允许未解析字段绑定" });
  const grid = comp["grid"];
  if (!isObj(grid) || !Array.isArray(grid["cells"])) return;
  grid["cells"].forEach((row: unknown, ri: number) => {
    if (!Array.isArray(row)) return;
    row.forEach((cell: unknown, ci: number) => {
      if (!isObj(cell) || !Array.isArray(cell["children"])) return;
      cell["children"].forEach((child: unknown, ki: number) => validateResolvedBinding(child, `${path}.grid.cells.${ri}.${ci}.children.${ki}`, errors));
    });
  });
}

export function validatePage(
  page: unknown,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[] = []
): void {
  if (!isObj(page)) {
    errors.push({ path, message: "页应为对象" });
    return;
  }
  const w = page["pageWidthMm"];
  const h = page["pageHeightMm"];
  if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) {
    errors.push({ path: `${path}.pageWidthMm`, message: `页宽非法: ${describeValue(w)}` });
  }
  if (typeof h !== "number" || !(h > 0 && h < 5000)) {
    errors.push({ path: `${path}.pageHeightMm`, message: `页高非法: ${describeValue(h)}` });
  }
  if (page["layout"] !== undefined && page["layout"] !== "page" && page["layout"] !== "wide") {
    errors.push({ path: `${path}.layout`, message: "布局应为 page 或 wide" });
  }
  const comps = page["components"];
  if (!Array.isArray(comps)) {
    errors.push({ path: `${path}.components`, message: "components 应为数组" });
  } else if (Array.isArray(comps)) {
    const issue = componentTreeIssue(comps, `${path}.components`);
    if (issue) { errors.push(issue); return; }
    comps.forEach((comp, i) => {
      validateComponentFields(comp, `${path}.components.${i}`, errors, warnings);
      validateResolvedBinding(comp, `${path}.components.${i}`, errors);
    });
  }
}

export function validateRenderPlan(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const pages = isObj(input) ? input["pages"] : undefined;
  if (isObj(input) && input["requiresRecalculation"] !== undefined && typeof input["requiresRecalculation"] !== "boolean") errors.push({ path: "$.requiresRecalculation", message: "重算能力要求应为布尔值" });
  if (!Array.isArray(pages)) {
    errors.push({
      path: "$.pages",
      message: input == null ? "渲染计划为空" : "渲染计划缺少 pages 数组"
    });
  } else {
    const issue = renderTreeIssue(pages);
    if (issue) return { ok: false, errors: [...errors, issue], warnings };
    pages.forEach((page, i) => validatePage(page, `$.pages.${i}`, errors, warnings));
    // 规模告警：异常大的计划（网关异常/模板失控）提前预警，不阻塞渲染
    if (pages.length > 2_000) {
      warnings.push({
        path: "$.pages",
        message: `页数异常大（${pages.length} 页），渲染与打印耗时可能显著增加`
      });
    }
    const totalComponents = pages.reduce(
      (s, p) => s + (isObj(p) && Array.isArray(p["components"]) ? (p["components"] as unknown[]).length : 0),
      0
    );
    if (totalComponents > 50_000) {
      warnings.push({
        path: "$.pages",
        message: `组件总数异常大（${totalComponents} 个），可能触发浏览器性能限制`
      });
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function assertRenderPlan(input: unknown): PlanPage[] {
  const result = validateRenderPlan(input);
  if (!result.ok) {
    const head = result.errors
      .slice(0, 3)
      .map((e) => `${e.path}: ${e.message}`)
      .join("; ");
    throw new Error(`渲染计划校验失败(${result.errors.length} 处): ${head}`);
  }
  return (input as { pages: PlanPage[] }).pages;
}

export type { PlanComponent, PlanPage };
