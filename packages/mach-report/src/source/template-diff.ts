import { parseReportTemplate, type ReportTemplateDocument } from "./template-registry";

export interface ReportTemplateChange {
  kind: "added" | "removed" | "modified" | "moved";
  category: "metadata" | "structure" | "binding" | "calculation" | "format";
  path: string;
  before?: string;
  after?: string;
  breaking: boolean;
}
export interface ReportTemplateDiff { changes: ReportTemplateChange[]; totalChanges: number; truncated: boolean; breakingChanges: number }

function display(value: unknown): string | undefined {
  if (value === undefined) return;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 160 ? text.slice(0, 157) + "…" : text;
}
function category(path: string): ReportTemplateChange["category"] {
  if (/\.(?:computed|computeOptions|groups|groupBy|aggregates|grandTotal)(?:\.|\[|$)/.test(path)) return "calculation";
  if (/\.(?:dataset|field|rowKey|revisionField|sourceTokenField|foreignKey|parentKey)$/.test(path)) return "binding";
  if (/\.(?:style|headerStyle|format|rules|align|headerAlign|semanticRole|unit)(?:\.|\[|$)/.test(path)) return "format";
  return path.startsWith("$.template") ? "structure" : "metadata";
}
function stableFields(value: unknown[]): Map<string, unknown> | undefined {
  const result = new Map<string, unknown>();
  for (const item of value) {
    if (!item || typeof item !== "object" || !("field" in item) || typeof item.field !== "string" || result.has(item.field)) return;
    result.set(item.field, item);
  }
  return result;
}
function parameterBreaking(path: string, kind: ReportTemplateChange["kind"], right: unknown): boolean {
  if (!path.startsWith("$.template.params") || kind === "moved") return false;
  if (/\.(?:type|required|min|max|minLength|maxLength|options|defaultValue)(?:\[|$)/.test(path)) return true;
  if (kind !== "added") return false;
  if (Array.isArray(right)) return right.some((item: unknown) => !!item && typeof item === "object" && "required" in item && item.required === true);
  return !!right && typeof right === "object" && "required" in right && right.required === true;
}

/** Semantic column identities keep a reorder distinct from deleting or rebinding a field. */
export function diffReportTemplates(previous: ReportTemplateDocument, next: ReportTemplateDocument, options: { maxChanges?: number } = {}): ReportTemplateDiff {
  const before = parseReportTemplate(previous), after = parseReportTemplate(next);
  const limit = options.maxChanges ?? 500;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new RangeError("maxChanges must be between 1 and 10000");
  const result: ReportTemplateDiff = { changes: [], totalChanges: 0, breakingChanges: 0, truncated: false };
  function add(kind: ReportTemplateChange["kind"], path: string, left: unknown, right: unknown): void {
    const group = category(path);
    const breaking = kind !== "moved" && (group === "binding" || path === "$.id" || kind === "removed" && group === "structure" || parameterBreaking(path, kind, right));
    result.totalChanges++; if (breaking) result.breakingChanges++;
    if (result.changes.length < limit) result.changes.push({ kind, category: group, path, before: display(left), after: display(right), breaking });
  }
  function columns(left: unknown[], right: unknown[], path: string): boolean {
    const first = stableFields(left), second = stableFields(right);
    if (!first || !second) return false;
    const positions = new Map(right.map((item, index) => [(item as { field: string }).field, index]));
    Array.from(first).forEach(([field, item], index) => {
      const here = `${path}[${JSON.stringify(field)}]`;
      if (!second.has(field)) add("removed", here, item, undefined);
      else { if (positions.get(field) !== index) add("moved", here, index, positions.get(field)); visit(item, second.get(field), here); }
    });
    for (const [field, item] of second) if (!first.has(field)) add("added", `${path}[${JSON.stringify(field)}]`, undefined, item);
    return true;
  }
  function visit(left: unknown, right: unknown, path: string): void {
    if (Object.is(left, right) || path === "$.revision") return;
    if (left === undefined || right === undefined) { add(left === undefined ? "added" : "removed", path, left, right); return; }
    if (Array.isArray(left) && Array.isArray(right)) {
      if ((path.endsWith(".columns") || path.endsWith(".params")) && columns(left, right, path)) return;
      for (let index = 0; index < Math.max(left.length, right.length); index++) visit(left[index], right[index], `${path}[${index}]`);
    } else if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], `${path}.${key}`);
    } else add("modified", path, left, right);
  }
  visit(before, after, "$");
  result.truncated = result.totalChanges > result.changes.length;
  return result;
}
