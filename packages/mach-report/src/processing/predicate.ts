import { compareDecimal, parseDecimal } from "./decimal";

export type ReportPredicateScalar = string | number | boolean | null;
export type ReportPredicateOperand = { field: string } | { value: ReportPredicateScalar };
export interface ReportComparison {
  field: string;
  op: ">" | ">=" | "<" | "<=" | "==" | "!=" | "between" | "contains" | "isNull" | "isNotNull";
  /** Legacy scalar thresholds remain supported. Use right for field-to-field comparisons. */
  value?: ReportPredicateScalar;
  right?: ReportPredicateOperand;
  values?: readonly [ReportPredicateScalar, ReportPredicateScalar];
  numeric?: "number" | "decimal";
  valueType?: "number" | "decimal" | "text" | "date" | "boolean";
}
export type ReportPredicate = ReportComparison | { all: readonly ReportPredicate[] } | { any: readonly ReportPredicate[] } | { not: ReportPredicate };
export type ReportPredicateReader = (row: Readonly<Record<string, unknown>>) => boolean;
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("条件应为普通声明式对象");
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) if (unsafe.has(key) || !Object.prototype.hasOwnProperty.call(descriptor, "value")) throw new Error("条件不允许访问器或不安全属性");
}
function field(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || unsafe.has(value)) throw new Error("条件字段应为安全的非空字段名");
}
function scalar(value: unknown): asserts value is ReportPredicateScalar {
  if (value !== null && typeof value !== "boolean" && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) throw new Error("条件常量应为有限 JSON 标量");
  if (typeof value === "string" && value.length > 16_384) throw new Error("条件文本超出预算");
}
export function predicateCalendarDay(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("日期条件使用 YYYY-MM-DD 日历日");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0); date.setUTCFullYear(year!, month! - 1, day!); date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) throw new Error("无效日历日");
  return value;
}
function textScalar(value: unknown): boolean { return ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value); }
function missingComparisonValue(value: unknown): boolean { return value == null || value === ""; }
function comparisonType(rule: ReportComparison): NonNullable<ReportComparison["valueType"]> {
  const threshold = rule.values?.[0] ?? (rule.right && "value" in rule.right ? rule.right.value : rule.value);
  return rule.valueType ?? rule.numeric ?? (typeof threshold === "number" ? "decimal" : typeof threshold === "boolean" ? "boolean" : "text");
}
function compare(left: unknown, right: unknown, rule: ReportComparison): number | undefined {
  if (missingComparisonValue(left) || missingComparisonValue(right)) return undefined;
  const type = comparisonType(rule);
  try {
    if (type === "decimal") return compareDecimal(parseDecimal(left), parseDecimal(right));
    if (type === "number") {
      // Legacy numeric:number accepts numeric text without converting blanks/booleans.
      if (!["number", "string"].includes(typeof left) || !["number", "string"].includes(typeof right)) return undefined;
      return compareDecimal(parseDecimal(left), parseDecimal(right));
    }
    if (type === "date") { left = predicateCalendarDay(left); right = predicateCalendarDay(right); }
    if (type === "boolean" && (typeof left !== "boolean" || typeof right !== "boolean")) return undefined;
    if (type === "text" && (!textScalar(left) || !textScalar(right))) return undefined;
    const a = String(left), b = String(right); return a < b ? -1 : a > b ? 1 : 0;
  } catch { return undefined; }
}
function checkComparison(rule: ReportComparison): void {
  field(rule.field);
  if (![">", ">=", "<", "<=", "==", "!=", "between", "contains", "isNull", "isNotNull"].includes(rule.op)) throw new Error("未知条件运算符");
  if (rule.numeric !== undefined && !["number", "decimal"].includes(rule.numeric)) throw new Error("未知条件数值模式");
  if (rule.valueType !== undefined && !["number", "decimal", "text", "date", "boolean"].includes(rule.valueType)) throw new Error("未知条件值类型");
  if (rule.op === "isNull" || rule.op === "isNotNull") return;
  if (rule.op === "between") {
    if (!Array.isArray(rule.values) || rule.values.length !== 2 || Object.keys(rule.values).length !== 2) throw new Error("范围条件需要两个明确边界");
    rule.values.forEach(scalar);
    const order = compare(rule.values[0], rule.values[1], rule);
    if (order === undefined || order > 0) throw new Error("范围边界无效或顺序颠倒");
  } else if (rule.right !== undefined) {
    object(rule.right);
    if (Object.keys(rule.right).length !== 1) throw new Error("条件 right 只能指定一个 field 或 value");
    if ("field" in rule.right) field(rule.right.field); else scalar(rule.right.value);
    if (rule.value !== undefined) throw new Error("条件不能同时指定 value 和 right");
  } else scalar(rule.value);
}
function compareResult(op: string, result: number | undefined): boolean {
  if (result === undefined) return false;
  switch (op) { case ">": return result > 0; case ">=": return result >= 0; case "<": return result < 0; case "<=": return result <= 0; case "==": return result === 0; case "!=": return result !== 0; default: return false; }
}
function comparisonReader(rule: ReportComparison): ReportPredicateReader {
  checkComparison(rule);
  rule = { ...rule, right: rule.right ? { ...rule.right } : undefined, values: rule.values ? [rule.values[0], rule.values[1]] : undefined };
  const read = (row: Readonly<Record<string, unknown>>, name: string) => Object.prototype.hasOwnProperty.call(row, name) ? row[name] : undefined;
  return (row) => {
    const left = read(row, rule.field);
    if (rule.op === "isNull") return left == null;
    if (rule.op === "isNotNull") return left != null;
    if (rule.op === "between") return compareResult(">=", compare(left, rule.values![0], rule)) && compareResult("<=", compare(left, rule.values![1], rule));
    const right = rule.right ? "field" in rule.right ? read(row, rule.right.field) : rule.right.value : rule.value;
    if (rule.op === "contains") return typeof left === "string" && typeof right === "string" && left.includes(right);
    return compareResult(rule.op, compare(left, right, rule));
  };
}
/** Bounded declarative conditions shared by visibility, styles, IF and candidate validation. */
export function compileReportPredicate(predicate: ReportPredicate, budget = { nodes: 0 }, depth = 0): ReportPredicateReader {
  if (++budget.nodes > 256 || depth > 16) throw new Error("条件超出深度或节点预算");
  object(predicate);
  const variants = ["all", "any", "not", "field"].filter(key => Object.prototype.hasOwnProperty.call(predicate, key));
  if (variants.length !== 1) throw new Error("条件只能指定一种组合或比较");
  if ("not" in predicate) { const read = compileReportPredicate(predicate.not, budget, depth + 1); return row => !read(row); }
  if ("all" in predicate || "any" in predicate) {
    const nodes = "all" in predicate ? predicate.all : predicate.any;
    if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > 256 || Object.keys(nodes).length !== nodes.length) throw new Error("组合条件需要有界、无空位的非空数组");
    const readers = nodes.map(node => compileReportPredicate(node, budget, depth + 1));
    return "all" in predicate ? row => readers.every(read => read(row)) : row => readers.some(read => read(row));
  }
  return comparisonReader(predicate);
}
export function evaluateReportPredicate(row: Readonly<Record<string, unknown>>, predicate: ReportPredicate): boolean { return compileReportPredicate(predicate)(row); }
export function reportPredicateFields(predicate: ReportPredicate): string[] {
  compileReportPredicate(predicate);
  const fields = new Set<string>();
  function visit(node: ReportPredicate): void {
    if ("all" in node) node.all.forEach(visit);
    else if ("any" in node) node.any.forEach(visit);
    else if ("not" in node) visit(node.not);
    else { fields.add(node.field); if (node.right && "field" in node.right) fields.add(node.right.field); }
  }
  visit(predicate); return [...fields];
}
