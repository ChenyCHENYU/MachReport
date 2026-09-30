import { evalExpr, ExprError, parseIfArgs } from "./expr";
import { SqlSyntaxError, tokenize, type Token } from "./tokenizer";

export { SqlSyntaxError } from "./tokenizer";

export interface RenderedSql {
  sql: string;
  binds: unknown[];
  warnings: string[];
}

export interface CompiledSql {
  original: string;
  /** 参数名集合（bind 与 subst 并集） */
  paramNames: string[];
  render(params: Record<string, unknown>): RenderedSql;
}

export class SqlValidationError extends Error {
  constructor(message: string, public readonly sql: string) {
    super(`SQL 校验失败: ${message}`);
    this.name = "SqlValidationError";
  }
}

const FORBIDDEN_TOP_LEVEL = /\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|call|exec|execute)\b/i;

export function compileDynamicSql(source: string): CompiledSql {
  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch (e) {
    if (e instanceof SqlSyntaxError) throw e;
    throw new SqlSyntaxError(String(e), 0, source);
  }
  const paramNames = new Set<string>();
  for (const t of tokens) {
    if (t.type === "bind" || t.type === "subst") paramNames.add(t.value!);
  }

  return {
    original: source,
    paramNames: [...paramNames],
    render(params: Record<string, unknown>): RenderedSql {
      const binds: unknown[] = [];
      const warnings: string[] = [];
      let out = "";
      for (const t of tokens) {
        switch (t.type) {
          case "literal":
            out += t.text;
            break;
          case "bind": {
            const name = t.value!;
            if (!(name in params)) {
              warnings.push(`参数 ${name} 未提供，按 NULL 绑定`);
              binds.push(null);
            } else {
              binds.push(params[name]);
            }
            out += "?";
            break;
          }
          case "subst": {
            const name = t.value!;
            if (!(name in params)) {
              warnings.push(`参数 ${name} 未提供，文本替换为空串`);
              out += "";
            } else {
              out += String(params[name]);
            }
            break;
          }
          case "if": {
            const { cond, whenTrue, whenFalse } = parseIfArgs(t.value!);
            let truthy: boolean;
            try {
              const v = evalExpr(cond, { params });
              truthy = v === true || (typeof v === "string" && v !== "") || (typeof v === "number" && v !== 0);
            } catch (e) {
              throw e instanceof ExprError ? e : new ExprError(String(e));
            }
            const branch = truthy ? whenTrue : whenFalse;
            let branchText: string;
            try {
              branchText = String(evalExpr(branch, { params }));
            } catch {
              branchText = branch;
            }
            const sub = compileDynamicSql(branchText);
            const rendered = sub.render(params);
            binds.push(...rendered.binds);
            warnings.push(...rendered.warnings);
            out += rendered.sql;
            break;
          }
          case "escape":
            out += t.text;
            break;
        }
      }
      return { sql: out, binds, warnings };
    }
  };
}

/**
 * 去注释：-- 行注释、# 行注释（仅行首/空白后，且排除 #{ 绑定占位）、/* 块注释。
 * 注意：此函数用于校验口径，输出会折叠空白。
 */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)--[^\n]*/g, "$1 ")
    .replace(/(^|\s)#(?!\{)[^\n]*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 剥离单引号字符串字面量（内容不参与关键字检查，防 'xxx into yyy' 误伤） */
function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * 单 SELECT 结构校验（词法层；AST 级校验见 ast-check.ts 双保险）：
 * - 去注释后必须以 select 或 with 开头
 * - 语句内除末尾外不允许出现分号
 * - 顶层禁止 DML/DDL/调用关键字（字符串字面量内容不参与匹配）
 */
export function assertSingleSelect(sql: string): void {
  const clean = stripSqlComments(sql);
  if (clean === "") throw new SqlValidationError("空 SQL", sql);
  if (!/^(select|with)\b/i.test(clean)) {
    throw new SqlValidationError("仅允许 SELECT 查询（需以 select/with 开头）", sql);
  }
  const body = clean.endsWith(";") ? clean.slice(0, -1) : clean;
  if (body.includes(";")) {
    throw new SqlValidationError("检测到多语句（分号），仅允许单条 SELECT", sql);
  }
  const codeOnly = stripStringLiterals(body);
  const m = FORBIDDEN_TOP_LEVEL.exec(codeOnly);
  if (m) {
    throw new SqlValidationError(`禁止的关键字: ${m[1]}`, sql);
  }
  if (/\binto\b/i.test(codeOnly)) {
    throw new SqlValidationError("禁止 SELECT INTO", sql);
  }
}

/** 便捷入口：编译 + 渲染 + 校验一体 */
export function renderDynamicSql(
  source: string,
  params: Record<string, unknown>
): RenderedSql {
  const compiled = compileDynamicSql(source);
  const rendered = compiled.render(params);
  assertSingleSelect(rendered.sql);
  return rendered;
}
