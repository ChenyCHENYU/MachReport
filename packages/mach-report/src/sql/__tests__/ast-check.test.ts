// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertSingleSelectAst } from "../ast-check";

describe("assertSingleSelectAst（AST 深度校验）", () => {
  it("普通 SELECT / CTE / UNION 通过且非降级", () => {
    for (const sql of [
      "select id, name from t where id = ?",
      "with x as (select 1 as a) select a from x",
      "select a from t1 union all select a from t2"
    ]) {
      const r = assertSingleSelectAst(sql);
      expect(r.ok, sql).toBe(true);
      expect(r.degraded, sql).toBe(false);
    }
  });

  it("DML/DDL 在 AST 层拒绝（词法层也能拦，但 AST 给出类型级证据）", () => {
    for (const sql of [
      "update t set a = 1",
      "delete from t",
      "insert into t values (1)",
      "create table t2 (a int)",
      "drop table t"
    ]) {
      const r = assertSingleSelectAst(sql);
      expect(r.ok, sql).toBe(false);
    }
  });

  it("多语句 AST 拒绝", () => {
    const r = assertSingleSelectAst("select 1; select 2");
    expect(r.ok).toBe(false);
  });

  it("SELECT ... INTO 在 AST 层被识别拒绝", () => {
    const r = assertSingleSelectAst("select * into t2 from t1");
    expect(r.ok).toBe(false);
  });

  it("方言不兼容 SQL 降级词法且不误杀", () => {
    const oracleStyle = "select nvl(a, 0) from t connect by prior id = pid";
    const r = assertSingleSelectAst(oracleStyle);
    expect(r.degraded).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("空/垃圾输入拒绝", () => {
    expect(assertSingleSelectAst("").ok).toBe(false);
    expect(assertSingleSelectAst("not a sql at all !!!").ok).toBe(false);
  });
});
