import type { PlanComponent, PlanPage } from "./render-plan";
import { validateGridCellEditingMetadata } from "./cell-edit-validation";

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

function checkNumber(obj: Record<string, unknown>, key: string, path: string, errors: ValidationError[]): void {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push({ path: `${path}.${key}`, message: `应为有限数字，实际 ${JSON.stringify(v)}` });
  }
}

function validateTableSource(table: unknown, path: string, errors: ValidationError[]): void {
  if (table !== undefined) {
    const tablePath = `${path}.table`;
    if (!isObj(table)) errors.push({ path: tablePath, message: "逻辑表来源应为对象" });
    else {
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
          if (Array.isArray(cell["children"])) {
            (cell["children"] as unknown[]).forEach((child, ki) => {
              validateComponent(child, `${path}.grid.cells.${ri}.${ci}.children.${ki}`, errors, warnings);
            });
          }
        });
      });
    }
  }
}

function validateRichText(rich: unknown, path: string, errors: ValidationError[]): void {
  if (rich !== undefined) {
    if (!Array.isArray(rich)) {
      errors.push({ path: `${path}.richParagraphs`, message: "richParagraphs 应为数组" });
    } else {
      rich.forEach((para, i) => {
        if (!isObj(para) || !Array.isArray(para["segments"])) {
          errors.push({ path: `${path}.richParagraphs.${i}`, message: "段落缺少 segments 数组" });
        }
      });
    }
  }}

export function validateComponent(
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
      message: `未知组件类型 ${JSON.stringify(kind)}，将以兜底方式渲染`
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
  validateGrid(comp["grid"], path, errors, warnings);
  validateRichText(comp["richParagraphs"], path, errors);
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
    errors.push({ path: `${path}.pageWidthMm`, message: `页宽非法: ${JSON.stringify(w)}` });
  }
  if (typeof h !== "number" || !(h > 0 && h < 5000)) {
    errors.push({ path: `${path}.pageHeightMm`, message: `页高非法: ${JSON.stringify(h)}` });
  }
  if (page["layout"] !== undefined && page["layout"] !== "page" && page["layout"] !== "wide") {
    errors.push({ path: `${path}.layout`, message: "布局应为 page 或 wide" });
  }
  const comps = page["components"];
  if (!Array.isArray(comps)) {
    errors.push({ path: `${path}.components`, message: "components 应为数组" });
  } else if (Array.isArray(comps)) {
    comps.forEach((comp, i) =>
      validateComponent(comp, `${path}.components.${i}`, errors, warnings)
    );
  }
}

export function validateRenderPlan(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const pages = isObj(input) ? input["pages"] : undefined;
  if (!Array.isArray(pages)) {
    errors.push({
      path: "$.pages",
      message: input == null ? "渲染计划为空" : "渲染计划缺少 pages 数组"
    });
  } else {
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
