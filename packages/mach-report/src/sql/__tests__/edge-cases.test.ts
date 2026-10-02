// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compileDynamicSql, renderDynamicSql, stripSqlComments } from "../compile";
import { SqlSyntaxError } from "../tokenizer";

describe("sql-engine 边界补强", () => {
  it("嵌套 {if}：未引用分支整体回退再编译", () => {
    const sql =
      "select * from t where 1=1 {if(isEmpty(#a), {if(isEmpty(#b), \"\", \"and b=#{b}\")}, \"and a=#{a}\")}";
    const c = compileDynamicSql(sql);
    const r1 = c.render({ a: "A", b: "" });
    expect(r1.sql).toBe("select * from t where 1=1 and a=?");
    expect(r1.binds).toEqual(["A"]);
    const r2 = c.render({ a: "", b: "B" });
    expect(r2.sql).toBe("select * from t where 1=1 and b=?");
    expect(r2.binds).toEqual(["B"]);
    const r3 = c.render({ a: "", b: "" });
    expect(r3.sql).toBe("select * from t where 1=1 ");
  });

  it("连续两个动态条件互不干扰", () => {
    const sql =
      "select * from t where 1=1 {if(isEmpty(#a), \"\", \"and a=#{a}\")} {if(isEmpty(#b), \"\", \"and b=#{b}\")}";
    const c = compileDynamicSql(sql);
    const r = c.render({ a: "1", b: "" });
    expect(r.sql).toBe("select * from t where 1=1 and a=? ");
    expect(r.binds).toEqual(["1"]);
    const r2 = c.render({ a: "", b: "2" });
    expect(r2.sql).toBe("select * from t where 1=1  and b=?");
    expect(r2.binds).toEqual(["2"]);
  });

  it("${} 缺参告警但 SQL 不中断", () => {
    const r = compileDynamicSql("select * from ${t}").render({});
    expect(r.sql).toBe("select * from ");
    expect(r.warnings.some((w) => w.includes("t"))).toBe(true);
  });

  it("参数名带空格容忍（#{ id }）", () => {
    const r = compileDynamicSql("select * from t where id=#{ id }").render({ id: 5 });
    expect(r.sql).toBe("select * from t where id=?");
    expect(r.binds).toEqual([5]);
  });

  it("转义与占位混排", () => {
    const r = compileDynamicSql("select '\\{3\\}' || #{v} as s").render({ v: "x" });
    expect(r.sql).toBe("select '{3}' || ? as s");
  });

  it("未闭合字符串字面量报 ExprError 而非静默", () => {
    expect(() =>
      compileDynamicSql('{if(#a == "oops, "", "x")}').render({ a: 1 })
    ).toThrow();
  });

  it("空 if 分支字符串遵循双引号转义语义", () => {
    const sql = `{if(isEmpty(#a), "", "and name = 'x'")}`;
    const r = compileDynamicSql(sql).render({ a: "1" });
    expect(r.sql).toContain("and name = 'x'");
  });

  it("渲染结果为空串时 renderDynamicSql 抛校验错", () => {
    expect(() => renderDynamicSql("", {})).toThrow();
  });

  it("大 SQL（200 个动态条件）编译渲染正确", () => {
    const parts = Array.from({ length: 200 }, (_, i) =>
      `{if(isEmpty(#f${i}), "", "and f${i}=#{f${i}}")}`
    );
    const sql = `select * from t where 1=1 ${parts.join(" ")}`;
    const params: Record<string, string> = {};
    for (let i = 0; i < 200; i += 2) params[`f${i}`] = String(i);
    const r = renderDynamicSql(sql, params);
    expect(r.binds).toHaveLength(100);
    expect((r.sql.match(/\?/g) || []).length).toBe(100);
  });

  it("SqlSyntaxError 携带位置信息", () => {
    try {
      compileDynamicSql("select #{x from t");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SqlSyntaxError);
      expect((e as SqlSyntaxError).position).toBeGreaterThan(0);
    }
  });

  it("# 行注释被剥离且不影响 #{ 绑定", () => {
    expect(stripSqlComments("select 1 # 整行注释")).toBe("select 1");
    expect(stripSqlComments("select #{a} from t")).toBe("select #{a} from t");
    const r = renderDynamicSql("select id from t where id=#{a} #注释", { a: 1 });
    expect(r.sql).toContain("?");
    expect(r.binds).toEqual([1]);
  });

  it("字符串字面量中的 into/关键字不误伤", () => {
    const r = renderDynamicSql("select 'put into box', col_update from t", {});
    expect(r.sql).toContain("'put into box'");
  });

  it("SELECT INTO 仍被拒绝", () => {
    expect(() =>
      renderDynamicSql("select * into new_t from t", {})
    ).toThrowError(/SELECT INTO/);
  });
});
