import { Parser } from "node-sql-parser";
import { assertSingleSelect } from "./compile";

export interface AstCheckResult {
  ok: boolean;
  /** ast 深度校验是否执行（方言不支持时降级词法） */
  degraded: boolean;
  message?: string;
}

function isSelectAst(ast: unknown): boolean {
  if (ast == null || typeof ast !== "object") return false;
  const type = (ast as { type?: unknown }).type;
  return type === "select" || type === "union" || type === "except" || type === "intersect";
}

/**
 * AST 深度校验（双保险策略）：
 * 1. node-sql-parser（MySQL 方言，支持 ? 占位符）AST 顶层必须为 SELECT/集合运算
 * 2. AST 通过后再叠加词法校验（MySQL 方言把 SELECT INTO 解析为别名，AST 层不可见，
 *    由词法层兜底拦截）
 * AST 解析失败（方言不兼容）自动降级为纯词法校验，返回 degraded=true。
 */
export function assertSingleSelectAst(sql: string): AstCheckResult {
  const astResult = checkAstTopLevel(sql);
  try {
    assertSingleSelect(sql);
    return { ok: true, degraded: !astResult };
  } catch (lexError) {
    return {
      ok: false,
      degraded: false,
      message: lexError instanceof Error ? lexError.message : String(lexError)
    };
  }
}

/** 返回 true=AST 校验通过；false=解析失败或顶层非 SELECT（message 由词法层补充） */
function checkAstTopLevel(sql: string): boolean {
  try {
    const parser = new Parser();
    const ast = parser.astify(sql, { database: "MySQL" });
    const list = Array.isArray(ast) ? ast : [ast];
    if (list.length > 1) return false;
    return isSelectAst(list[0]);
  } catch {
    return false;
  }
}