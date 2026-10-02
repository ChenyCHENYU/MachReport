import { splitTopLevel } from "./tokenizer";

export interface ExprContext {
  params: Record<string, unknown>;
}

export class ExprError extends Error {
  constructor(message: string) {
    super(`公式表达式错误: ${message}`);
    this.name = "ExprError";
  }
}

/**
 * 求值动态 SQL 条件表达式（用于 {if(cond, a, b)} 的 cond 与操作数）：
 * - #param 引用（渲染时被替换为参数值；此实现按值求值）
 * - "..." 字符串字面量（仅双引号）
 * - isEmpty(x)、isNotEmpty(x)
 * - == / != 比较
 * - + 拼接
 */
export function evalExpr(input: string, ctx: ExprContext): unknown {
  const trimmed = input.trim();
  const literalMatch = trimmed.startsWith(`"`) ? /^"([^"]*)"$/.exec(trimmed) : null;
  if (literalMatch) return literalMatch[1]!;
  const call = /^(isEmpty|isNotEmpty)\((.*)\)$/s.exec(trimmed);
  if (call) {
    const inner = evalExpr(call[2]!, ctx);
    const empty = inner == null || inner === "";
    return call[1] === "isEmpty" ? empty : !empty;
  }
  const paren = /^\((.*)\)$/s.exec(trimmed);
  if (paren) {
    return evalExpr(paren[1]!, ctx);
  }
  const cmp = splitByOperator(trimmed, ["==", "!="]);
  if (cmp) {
    const left = evalExpr(cmp.left, ctx);
    const right = evalExpr(cmp.right, ctx);
    return cmp.op === "==" ? String(left) === String(right) : String(left) !== String(right);
  }
  const concatIdx = findTopLevelPlus(trimmed);
  if (concatIdx >= 0) {
    const left = evalExpr(trimmed.slice(0, concatIdx), ctx);
    const right = evalExpr(trimmed.slice(concatIdx + 1), ctx);
    return `${stringify(left)}${stringify(right)}`;
  }
  if (trimmed.startsWith("#")) {
    const name = trimmed.slice(1).trim();
    return name in ctx.params ? ctx.params[name] : "";
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith(`"`)) {
    throw new ExprError(`字符串未闭合: ${trimmed}`);
  }
  throw new ExprError(`无法识别的表达式: ${trimmed}`);
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return String(v);
}

function splitByOperator(
  input: string,
  ops: string[]
): { op: string; left: string; right: string } | null {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inString) {
      if (ch === `"`) inString = false;
      continue;
    }
    if (ch === `"`) inString = true;
    else if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") depth--;
    else if (depth === 0) {
      for (const op of ops) {
        if (input.startsWith(op, i)) {
          return { op, left: input.slice(0, i), right: input.slice(i + op.length) };
        }
      }
    }
  }
  return null;
}

function findTopLevelPlus(input: string): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inString) {
      if (ch === `"`) inString = false;
      continue;
    }
    if (ch === `"`) inString = true;
    else if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") depth--;
    else if (ch === "+" && depth === 0) return i;
  }
  return -1;
}

/** {if(cond, whenTrue, whenFalse)} 的参数拆分（2 或 3 段） */
export function parseIfArgs(inner: string): { cond: string; whenTrue: string; whenFalse: string } {
  const parts = splitTopLevel(inner);
  if (parts.length === 2) {
    return { cond: parts[0]!, whenTrue: parts[1]!, whenFalse: "" };
  }
  if (parts.length === 3) {
    return { cond: parts[0]!, whenTrue: parts[1]!, whenFalse: parts[2]! };
  }
  throw new ExprError(`if() 需要 2~3 个参数，实际 ${parts.length} 段: ${inner}`);
}
