import type { PlanComponent, PlanPage } from "./render-plan";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
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
  if (v === undefined || v === null) return;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    errors.push({ path: `${path}.${key}`, message: `应为有限数字，实际 ${JSON.stringify(v)}` });
  }
}

export function validateComponent(comp: unknown, path: string, errors: ValidationError[]): void {
  if (!isObj(comp)) {
    errors.push({ path, message: "组件应为对象" });
    return;
  }
  const kind = comp["kind"];
  if (typeof kind !== "string" || !KNOWN_KINDS.has(kind)) {
    errors.push({
      path: `${path}.kind`,
      message: `未知组件类型 ${JSON.stringify(kind)}（已知：${[...KNOWN_KINDS].join("/")})`
    });
  }
  for (const key of ["leftMm", "topMm", "widthMm", "heightMm"]) {
    checkNumber(comp, key, path, errors);
  }
  if (comp["leftMm"] != null && comp["widthMm"] != null) {
    if ((comp["leftMm"] as number) < -100 || (comp["widthMm"] as number) < 0) {
      errors.push({ path, message: "几何数值异常（leftMm<-100 或 widthMm<0）" });
    }
  }
  const grid = comp["grid"];
  if (grid !== undefined) {
    if (!isObj(grid) || !Array.isArray(grid["cells"])) {
      errors.push({ path: `${path}.grid.cells`, message: "grid.cells 应为二维数组" });
    } else {
      (grid["cells"] as unknown[]).forEach((row, ri) => {
        if (!Array.isArray(row)) {
          errors.push({ path: `${path}.grid.cells.${ri}`, message: "行应为数组" });
          return;
        }
        row.forEach((cell, ci) => {
          if (cell === undefined || cell === null) return;
          if (isObj(cell) && Array.isArray(cell["children"])) {
            (cell["children"] as unknown[]).forEach((child, ki) => {
              validateComponent(child, `${path}.grid.cells.${ri}.${ci}.children.${ki}`, errors);
            });
          }
        });
      });
    }
  }
  const rich = comp["richParagraphs"];
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
  }
}

export function validatePage(page: unknown, path: string, errors: ValidationError[]): void {
  if (!isObj(page)) {
    errors.push({ path, message: "页应为对象" });
    return;
  }
  const w = page["pageWidthMm"];
  const h = page["pageHeightMm"];
  if (typeof w !== "number" || !(w > 0 && w < 3000)) {
    errors.push({ path: `${path}.pageWidthMm`, message: `页宽非法: ${JSON.stringify(w)}` });
  }
  if (typeof h !== "number" || !(h > 0 && h < 5000)) {
    errors.push({ path: `${path}.pageHeightMm`, message: `页高非法: ${JSON.stringify(h)}` });
  }
  const comps = page["components"];
  if (comps !== undefined && !Array.isArray(comps)) {
    errors.push({ path: `${path}.components`, message: "components 应为数组" });
  } else if (Array.isArray(comps)) {
    comps.forEach((comp, i) => validateComponent(comp, `${path}.components.${i}`, errors));
  }
}

export function validateRenderPlan(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const pages = isObj(input) ? input["pages"] : undefined;
  if (!Array.isArray(pages)) {
    errors.push({
      path: "$.pages",
      message: input == null ? "渲染计划为空" : "渲染计划缺少 pages 数组"
    });
  } else {
    pages.forEach((page, i) => validatePage(page, `$.pages.${i}`, errors));
  }
  return { ok: errors.length === 0, errors };
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
