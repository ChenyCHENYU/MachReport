import { bindingColumn } from "./binding-column";
import { checkedMetadata } from "./binding-json";
import type { ReportFieldContract, DatasetContract } from "../schema/dataset";
import { validateDatasetRows } from "../schema/dataset";
import type { ReportTemplateDocument } from "../source/template-registry";
import {
  defineReportTemplate,
  parseReportTemplate,
} from "../source/template-registry";
import {
  bindExcelTemplate,
  type ExcelTableBinding,
} from "./bind-template";
import { excelBindingMergeIssues } from "./binding-regions";
import { parseImportRange, rangeName } from "./import-range";
import type { ExcelImportResult } from "./import-types";

export interface ExcelBindingField extends ReportFieldContract {
  /** Display precision is explicit business metadata; decimal text is never coerced to number. */
  digits?: number;
  sample?: string | number | boolean | null;
}
export interface ExcelBindingDataset {
  id: string;
  label?: string;
  fields: readonly ExcelBindingField[];
  rowKey?: string;
  /** Optional representative API rows, used only for contract validation, never as live results. */
  samples?: readonly Record<string, unknown>[];
}
export type ExcelBindingRegion = "title" | "header" | "detail" | "footer";
/** Explicit coordinates and mappings, independently persistable alongside the source asset. */
export interface ExcelBindingRecipe {
  version: "1.0";
  sheet: string;
  dataset: string;
  regions: { title?: string; header: string; detail: string; footer?: string };
  /** One mapping for every physical Excel column. Empty strings remain invalid until confirmed. */
  fields: string[];
  rowKey: string;
}
export interface ExcelBindingIssue {
  path: string;
  code: "schema" | "region" | "mapping" | "row-key" | "source";
  message: string;
}
export interface ExcelBindingValidation {
  ok: boolean;
  issues: ExcelBindingIssue[];
  mapped: number;
  total: number;
}
export interface ExcelBindingSession {
  version: "1.0";
  /** Design source only. The compiled document never retains the sample detail rows. */
  source: ExcelImportResult;
  recipe: ExcelBindingRecipe;
  identity: { id: string; name: string };
}
export interface ExcelBindingDocumentResult {
  document: ReportTemplateDocument;
  recipe: ExcelBindingRecipe;
  warnings: string[];
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
function issue(
  issues: ExcelBindingIssue[],
  path: string,
  code: ExcelBindingIssue["code"],
  text: string,
): void {
  issues.push({ path, code, message: text });
}

function datasetContract(
  dataset: ExcelBindingDataset,
  rowKey?: string,
): DatasetContract {
  return { fields: dataset.fields, ...(rowKey ? { rowKey } : {}) };
}
function validateCatalog(
  datasets: readonly ExcelBindingDataset[],
  issues: ExcelBindingIssue[],
): void {
  const ids = new Set<string>();
  for (const [index, dataset] of datasets.entries()) {
    const path = `$.datasets[${index}]`;
    if (
      !dataset ||
      typeof dataset.id !== "string" ||
      !dataset.id.trim() ||
      ids.has(dataset.id)
    ) {
      issue(issues, path, "schema", "数据集标识应非空且唯一");
      continue;
    }
    ids.add(dataset.id);
    try {
      validateDatasetRows([], datasetContract(dataset, dataset.rowKey));
      for (const [fieldIndex, field] of dataset.fields.entries()) {
        if (
          field.digits !== undefined &&
          (!Number.isInteger(field.digits) ||
            field.digits < 0 ||
            field.digits > 100)
        )
          issue(
            issues,
            `${path}.fields[${fieldIndex}].digits`,
            "schema",
            "显示精度应为 0–100 的整数",
          );
      }
    } catch (cause) {
      issue(issues, path, "schema", message(cause));
    }
  }
}
function regionRanges(
  imported: ExcelImportResult,
  recipe: ExcelBindingRecipe,
  issues: ExcelBindingIssue[],
): void {
  const sheet = imported.sheets.find((item) => item.name === recipe.sheet);
  if (!sheet) {
    issue(issues, "$.recipe.sheet", "source", "指定的工作表不存在");
    return;
  }
  let source: ReturnType<typeof parseImportRange>;
  try {
    source = parseImportRange(sheet.range);
  } catch (cause) {
    issue(issues, "$.source.sheets", "source", message(cause));
    return;
  }
  const ranges = new Map<
    ExcelBindingRegion,
    ReturnType<typeof parseImportRange>
  >();
  for (const role of ["title", "header", "detail", "footer"] as const) {
    const text = recipe.regions?.[role];
    if (!text && (role === "title" || role === "footer")) continue;
    try {
      const range = parseImportRange(text ?? "");
      if (
        range.left !== source.left ||
        range.right !== source.right ||
        range.top < source.top ||
        range.bottom > source.bottom
      )
        throw new Error("区域必须覆盖选区完整列宽，并位于原始工作表内");
      ranges.set(role, range);
    } catch (cause) {
      issue(issues, `$.recipe.regions.${role}`, "region", message(cause));
    }
  }
  const ordered = [...ranges.values()];
  if (
    ordered.length &&
    (ordered[0]!.top !== source.top ||
      ordered[ordered.length - 1]!.bottom !== source.bottom)
  )
    issue(
      issues,
      "$.recipe.regions",
      "region",
      "标题、表头、明细、页脚应完整覆盖来源，不能隐式删除静态内容",
    );
  for (let index = 1; index < ordered.length; index++)
    if (ordered[index]!.top !== ordered[index - 1]!.bottom + 1)
      issue(issues, "$.recipe.regions", "region", "各区域应顺序相邻且不重叠");
}
function validateMappings(
  recipe: ExcelBindingRecipe,
  dataset: ExcelBindingDataset,
  total: number,
  issues: ExcelBindingIssue[],
): number {
  if (!Array.isArray(recipe.fields) || recipe.fields.length !== total) {
    issue(
      issues,
      "$.recipe.fields",
      "mapping",
      "每个物理 Excel 列必须显式绑定一个业务字段",
    );
    return 0;
  }
  const declared = new Set(dataset.fields.map((field) => field.field)),
    seen = new Set<string>();
  let mapped = 0;
  recipe.fields.forEach((field, index) => {
    if (typeof field !== "string" || !declared.has(field))
      issue(
        issues,
        `$.recipe.fields[${index}]`,
        "mapping",
        "请选择契约中已声明的字段",
      );
    else if (seen.has(field))
      issue(
        issues,
        `$.recipe.fields[${index}]`,
        "mapping",
        "同一业务字段不能重复绑定物理列",
      );
    else {
      mapped++;
      seen.add(field);
    }
  });
  try {
    if (!recipe.rowKey)
      throw new Error("请明确选择稳定业务主键，不能使用展示行号");
    const contract = datasetContract(dataset, recipe.rowKey);
    const result = validateDatasetRows(dataset.samples ?? [], contract, {
      path: `$.datasets.${dataset.id}.samples`,
      maxRows: 100,
      maxCells: 200_000,
      maxIssues: 30,
    });
    for (const rowIssue of result.issues)
      issue(
        issues,
        rowIssue.path,
        rowIssue.code === "row-key" ? "row-key" : "schema",
        rowIssue.message,
      );
  } catch (cause) {
    issue(issues, "$.recipe.rowKey", "row-key", message(cause));
  }
  return mapped;
}
/** Region-only validation lets reactive consumers reuse the result while only mappings change. */
export function validateExcelBindingRegions(
  imported: ExcelImportResult,
  recipe: ExcelBindingRecipe,
): ExcelBindingIssue[] {
  const issues: ExcelBindingIssue[] = [];
  if (!recipe || recipe.version !== "1.0")
    return [
      {
        path: "$.recipe.version",
        code: "schema",
        message: "不支持的 Excel 绑定配置版本",
      },
    ];
  regionRanges(imported, recipe, issues);
  if (!issues.length) issues.push(...excelBindingMergeIssues(imported, recipe));
  return issues;
}
/** Contract and mapping validation does not traverse imported grids. */
export function validateExcelBindingFields(
  imported: ExcelImportResult,
  recipe: ExcelBindingRecipe,
  datasets: readonly ExcelBindingDataset[],
): ExcelBindingValidation {
  const issues: ExcelBindingIssue[] = [];
  if (!recipe || recipe.version !== "1.0")
    return {
      ok: false,
      issues: [
        {
          path: "$.recipe.version",
          code: "schema",
          message: "不支持的 Excel 绑定配置版本",
        },
      ],
      mapped: 0,
      total: 0,
    };
  validateCatalog(datasets, issues);
  const total =
    imported.sheets.find((sheet) => sheet.name === recipe.sheet)?.columnCount ??
    0;
  const dataset = datasets.find((item) => item.id === recipe.dataset);
  let mapped = 0;
  if (!dataset)
    issue(
      issues,
      "$.recipe.dataset",
      "schema",
      "请明确选择宿主提供的数据集契约",
    );
  else if (!issues.some((item) => item.code === "schema"))
    mapped = validateMappings(recipe, dataset, total, issues);
  return { ok: issues.length === 0, issues, mapped, total };
}
/** Shared browser/Node validation. No header-name guessing, coercion, network or formula execution. */
export function validateExcelBindingRecipe(
  imported: ExcelImportResult,
  recipe: ExcelBindingRecipe,
  datasets: readonly ExcelBindingDataset[],
): ExcelBindingValidation {
  const result = validateExcelBindingFields(imported, recipe, datasets);
  if (!recipe || recipe.version !== "1.0") return result;
  const issues = [
    ...validateExcelBindingRegions(imported, recipe),
    ...result.issues,
  ];
  return { ...result, ok: issues.length === 0, issues };
}
/** Compile only the selected sheet to a new template; all sample detail values are removed. */
export function createExcelBindingDocument(
  imported: ExcelImportResult,
  recipe: ExcelBindingRecipe,
  datasets: readonly ExcelBindingDataset[],
  identity: { id: string; name: string },
): ExcelBindingDocumentResult {
  const validation = validateExcelBindingRecipe(imported, recipe, datasets);
  if (!validation.ok)
    throw new Error(
      validation.issues
        .map((item) => `${item.path}: ${item.message}`)
        .join("\n"),
    );
  const source = imported.sheets.find((item) => item.name === recipe.sheet)!;
  const selected: ExcelImportResult = {
    ...imported,
    sheets: [{ ...source, pageStart: 0 }],
    template: {
      ...imported.template,
      pages: imported.template.pages.slice(
        source.pageStart,
        source.pageStart + source.pageCount,
      ),
    },
  };
  const fields = new Map(
    datasets
      .find((item) => item.id === recipe.dataset)!
      .fields.map((field) => [field.field, field]),
  );
  const binding: ExcelTableBinding = {
    sheet: recipe.sheet,
    dataset: recipe.dataset,
    header: recipe.regions.header,
    detail: recipe.regions.detail,
    rowKey: recipe.rowKey,
    inferSampleFormats: false,
    columns: recipe.fields.map((field) => bindingColumn(fields.get(field)!)),
  };
  const result = bindExcelTemplate(selected, [binding]);
  return {
    document: defineReportTemplate({ ...identity, template: result.template }),
    recipe: clone(recipe),
    warnings: result.warnings,
  };
}
function checkSessionRecipe(
  recipe: ExcelBindingRecipe,
  identity: { id: string; name: string },
): void {
  if (
    recipe?.version !== "1.0" ||
    !Array.isArray(recipe.fields) ||
    recipe.fields.length > 16384 ||
    recipe.fields.some((item) => typeof item !== "string")
  )
    throw new Error("Excel 绑定配置无效");
  if (
    typeof recipe.dataset !== "string" ||
    typeof recipe.rowKey !== "string" ||
    !recipe.regions ||
    typeof identity?.id !== "string" ||
    typeof identity.name !== "string"
  )
    throw new Error("Excel 绑定参数或标识无效");
  for (const range of Object.values(recipe.regions))
    if (range !== "") parseImportRange(range);
}
function checkSessionSheets(source: ExcelImportResult): void {
  for (const sheet of source.sheets) {
    parseImportRange(sheet.range);
    if (
      typeof sheet.name !== "string" ||
      ![sheet.index, sheet.rowCount, sheet.columnCount, sheet.pageCount].every(
        (item) => Number.isInteger(item) && item > 0,
      ) ||
      !Number.isInteger(sheet.pageStart) ||
      sheet.pageStart < 0 ||
      sheet.pageStart + sheet.pageCount > source.template.pages.length
    )
      throw new Error("Excel 绑定工作表几何元数据无效");
  }
}
function assertSession(
  source: ExcelImportResult,
  recipe: ExcelBindingRecipe,
  identity: { id: string; name: string },
): void {
  checkedMetadata({
    sheets: source.sheets,
    warnings: source.warnings,
    recipe,
    identity,
  });
  if (
    !Array.isArray(source.sheets) ||
    !source.sheets.length ||
    source.sheets.length > 32 ||
    !Array.isArray(source.warnings) ||
    source.warnings.some((item) => typeof item !== "string")
  )
    throw new Error("Excel 绑定来源元数据无效");
  checkSessionRecipe(recipe, identity);
  if (!source.sheets.some((sheet) => sheet.name === recipe.sheet))
    throw new Error("Excel 绑定工作表不存在");
  checkSessionSheets(source);
}
/** Persist this JSON beside the template to reopen exact regions/mappings without retaining File or runtime handles. */
export function createExcelBindingSession(
  imported: ExcelImportResult,
  recipe: ExcelBindingRecipe,
  identity: { id: string; name: string },
): ExcelBindingSession {
  assertSession(imported, recipe, identity);
  // The normal document guard also rejects unsafe prototypes/accessors/functions in the source template.
  parseReportTemplate({
    schemaVersion: "1.0",
    id: identity.id,
    name: identity.name,
    template: imported.template,
  });
  return clone({ version: "1.0", source: imported, recipe, identity });
}
export function parseExcelBindingSession(input: unknown): ExcelBindingSession {
  if (typeof input === "string" && input.length > 10_000_000)
    throw new Error("Excel 绑定会话超过 1000 万字符上限");
  const session =
    typeof input === "string"
      ? (JSON.parse(input) as ExcelBindingSession)
      : (input as ExcelBindingSession);
  if (
    !session ||
    session.version !== "1.0" ||
    session.recipe?.version !== "1.0" ||
    !Array.isArray(session.source?.sheets)
  )
    throw new Error("Excel 绑定会话结构或版本无效");
  return createExcelBindingSession(
    session.source,
    session.recipe,
    session.identity,
  );
}
/** Row selection is graphical; this helper converts it to explicit full-width coordinates. */
export function excelBindingRowRange(
  imported: ExcelImportResult,
  sheetName: string,
  from: number,
  to: number,
): string {
  const sheet = imported.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error("工作表不存在");
  const range = parseImportRange(sheet.range);
  const top = Math.min(from, to),
    bottom = Math.max(from, to);
  if (
    !Number.isInteger(top) ||
    !Number.isInteger(bottom) ||
    top < range.top ||
    bottom > range.bottom
  )
    throw new Error("选中行超出来源区域");
  return rangeName({ ...range, top, bottom });
}
