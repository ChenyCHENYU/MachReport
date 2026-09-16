export type TokenType =
  | "literal"
  | "bind"
  | "subst"
  | "if"
  | "escape";

export interface Token {
  type: TokenType;
  text: string;
  /** bind/subst 参数名；if 表达式源码 */
  value?: string;
  start: number;
  end: number;
}

export class SqlSyntaxError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly source: string
  ) {
    super(`${message} (at ${position})`);
    this.name = "SqlSyntaxError";
  }
}

/**
 * 扫描动态 SQL，产出 token 流：
 * - literal: 纯 SQL 文本（已反转义 \{ \}）
 * - bind:    #{name}
 * - subst:   ${name}
 * - if:      {if(expr, a, b)} —— value 为去壳后的参数串
 * - escape:  \{ 或 \}
 */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let buf = "";
  let i = 0;
  const pushLiteral = (start: number, end: number) => {
    if (buf) {
      tokens.push({ type: "literal", text: buf, start, end });
      buf = "";
    }
  };
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "\\" && (sql[i + 1] === "{" || sql[i + 1] === "}")) {
      buf += sql[i + 1];
      i += 2;
      continue;
    }
    if (ch === "#" && sql[i + 1] === "{") {
      const close = findClose(sql, i + 1);
      const name = sql.slice(i + 2, close).trim();
      if (!name) throw new SqlSyntaxError("空参数名 #{}}", i, sql);
      pushLiteral(i, i);
      tokens.push({ type: "bind", text: sql.slice(i, close + 1), value: name, start: i, end: close + 1 });
      i = close + 1;
      continue;
    }
    if (ch === "$" && sql[i + 1] === "{") {
      const close = findClose(sql, i + 1);
      const name = sql.slice(i + 2, close).trim();
      if (!name) throw new SqlSyntaxError("空参数名 ${}}", i, sql);
      pushLiteral(i, i);
      tokens.push({ type: "subst", text: sql.slice(i, close + 1), value: name, start: i, end: close + 1 });
      i = close + 1;
      continue;
    }
    if (ch === "{" && sql.slice(i, i + 4) === "{if(") {
      const close = findClose(sql, i);
      const innerEnd = sql[close - 1] === ")" ? close - 1 : close;
      const inner = sql.slice(i + 4, innerEnd);
      pushLiteral(i, i);
      tokens.push({ type: "if", text: sql.slice(i, close + 1), value: inner, start: i, end: close + 1 });
      i = close + 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  pushLiteral(sql.length, sql.length);
  return tokens;
}

/** 从 { 或 #{ / ${ 的 { 开始，找到配对的 }（考虑嵌套与字符串） */
function findClose(sql: string, openBrace: number): number {
  let depth = 0;
  let inString = false;
  for (let i = openBrace; i < sql.length; i++) {
    const ch = sql[i]!;
    if (inString) {
      if (ch === `"`) inString = false;
      continue;
    }
    if (ch === `"`) inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new SqlSyntaxError("未闭合的 {", openBrace, sql);
}

/** 按顶层逗号拆分（忽略双引号内与括号/花括号内） */
export function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let buf = "";
  for (const ch of input) {
    if (inString) {
      buf += ch;
      if (ch === `"`) inString = false;
      continue;
    }
    if (ch === `"`) {
      inString = true;
      buf += ch;
      continue;
    }
    if (ch === "(" || ch === "{") depth++;
    if (ch === ")" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0 || parts.length === 1);
}
