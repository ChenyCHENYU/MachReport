// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  compileDynamicSql,
  renderDynamicSql,
  assertSingleSelect,
  SqlValidationError,
  SqlSyntaxError
} from "../compile";

describe("compileDynamicSql: 基础语法", () => {
  it("#{} 渲染为占位符并按序绑定", () => {
    const r = compileDynamicSql("select * from t where id = #{id} and n = #{n}").render({
      id: "A1",
      n: 3
    });
    expect(r.sql).toBe("select * from t where id = ? and n = ?");
    expect(r.binds).toEqual(["A1", 3]);
  });

  it("${} 文本替换直拼", () => {
    const r = compileDynamicSql("select * from ${tab} where id = #{id}").render({
      tab: "orders",
      id: 1
    });
    expect(r.sql).toBe("select * from orders where id = ?");
  });

  it("缺参数时告警且不抛错", () => {
    const r = compileDynamicSql("select * from t where id = #{id}").render({});
    expect(r.sql).toContain("?");
    expect(r.binds).toEqual([null]);
    expect(r.warnings.some((w) => w.includes("id"))).toBe(true);
  });

  it("参数名集合去重", () => {
    const c = compileDynamicSql("#{a} #{a} ${b}");
    expect(c.paramNames.sort()).toEqual(["a", "b"]);
  });

  it("转义 \\{ 输出字面大括号（正则量词场景）", () => {
    const r = compileDynamicSql("select '\\{3}' as s").render({});
    expect(r.sql).toBe("select '{3}' as s");
  });

  it("未闭合的 #{} 抛语法错误", () => {
    expect(() => compileDynamicSql("select #{oops")).toThrowError(SqlSyntaxError);
  });
});

describe("compileDynamicSql: {if} 动态条件（手册范式）", () => {
  it("判空去条件：参数为空 → 条件消失", () => {
    const sql = "select * from t where 1=1 {if(isEmpty(#id), \"\", \"and id = #{id}\")}";
    const empty = compileDynamicSql(sql).render({ id: "" });
    expect(empty.sql).toBe("select * from t where 1=1 ");
    expect(empty.binds).toEqual([]);

    const filled = compileDynamicSql(sql).render({ id: "X" });
    expect(filled.sql).toBe("select * from t where 1=1 and id = ?");
    expect(filled.binds).toEqual(["X"]);
  });

  it("模糊查询范式", () => {
    const sql =
      "select * from t where 1=1 {if(#name == \"\", \"\", \"and name like concat('%', #{name}, '%')\")}";
    const r = compileDynamicSql(sql).render({ name: "钢" });
    expect(r.sql).toContain("name like concat('%', ?, '%')");
    expect(r.binds).toEqual(["钢"]);
    const r2 = compileDynamicSql(sql).render({ name: "" });
    expect(r2.sql).toBe("select * from t where 1=1 ");
  });

  it("多值 in 范式（$ 拼接 + 告警）", () => {
    const sql = "select * from t where 1=1 {if(#ids == \"\", \"\", \"and id in (\" + #ids + \")\")}";
    const r = compileDynamicSql(sql).render({ ids: "1,2,3" });
    expect(r.sql).toBe("select * from t where 1=1 and id in (1,2,3)");
  });

  it("字符串内逗号不破坏参数拆分", () => {
    const sql = "{if(isEmpty(#a), \"x,y\", \"and a=#{a}\")}";
    const r = compileDynamicSql(sql).render({ a: "" });
    expect(r.sql).toBe("x,y");
  });

  it("if 分支内的嵌套 #{} 正常绑定", () => {
    const sql = "{if(isEmpty(#id), \"1=1\", \"id = #{id} and code = #{id}\")}";
    const r = compileDynamicSql(sql).render({ id: "K9" });
    expect(r.sql).toBe("id = ? and code = ?");
    expect(r.binds).toEqual(["K9", "K9"]);
  });

  it("if() 参数个数错误抛 ExprError", () => {
    expect(() => compileDynamicSql("{if(#a)}").render({ a: 1 })).toThrowError(/2~3/);
  });
});

describe("assertSingleSelect 结构校验", () => {
  it("普通 SELECT 通过", () => {
    expect(() => assertSingleSelect("select * from t where id = ?")).not.toThrow();
  });

  it("CTE（with 开头）通过", () => {
    expect(() => assertSingleSelect("with x as (select 1) select * from x")).not.toThrow();
  });

  it("拒绝 UPDATE/DELETE/INSERT", () => {
    expect(() => assertSingleSelect("update t set a=1")).toThrowError(SqlValidationError);
    expect(() => assertSingleSelect("delete from t")).toThrowError(SqlValidationError);
    expect(() => assertSingleSelect("insert into t values(1)")).toThrowError(SqlValidationError);
  });

  it("拒绝多语句", () => {
    expect(() => assertSingleSelect("select 1; delete from t")).toThrowError(/多语句/);
  });

  it("注释里的关键字不误报", () => {
    expect(() =>
      assertSingleSelect("select * from t /* update trick */ where id = 1")
    ).not.toThrow();
    expect(() => assertSingleSelect("select * from t -- delete comment\n where id=1")).not.toThrow();
  });

  it("SELECT INTO 拒绝", () => {
    expect(() => assertSingleSelect("select * into t2 from t")).toThrowError(/INTO/);
  });

  it("union/子查询不误伤", () => {
    expect(() =>
      assertSingleSelect("select a from t1 union all select a from t2 where a in (select 1)")
    ).not.toThrow();
  });
});

describe("renderDynamicSql 一体化", () => {
  it("渲染 + 校验通过", () => {
    const r = renderDynamicSql(
      "select * from t where 1=1 {if(isEmpty(#id), \"\", \"and id = #{id}\")}",
      { id: "7" }
    );
    expect(r.sql).toBe("select * from t where 1=1 and id = ?");
  });

  it("动态条件全空时仍需为合法 SELECT", () => {
    const r = renderDynamicSql(
      "select * from t where 1=1 {if(isEmpty(#id), \"\", \"and id = #{id}\")}",
      {}
    );
    expect(r.sql).toBe("select * from t where 1=1 ");
  });
});
