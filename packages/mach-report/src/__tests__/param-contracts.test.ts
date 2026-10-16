// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTemplate } from "../builder/template-builder";
import { assertReportParams, reportParamsJsonSchema, validateReportParams } from "../source/param-validation";
import { createReportSource } from "../source/report-source";
import { createProviderReport } from "../source/provider";
import type { ReportParamDef } from "../layout/paginate";
import { validateReportTemplate } from "../source/template-registry";

const params: ReportParamDef[] = [
  { field: "plant", type: "select", required: true, defaultValue: "A", options: [{ label: "厂A", value: "A" }] },
  { field: "date", type: "date", required: true, min: "2024-01-01", max: "2026-12-31" },
  { field: "limit", type: "number", min: 1, max: 100, defaultValue: "20" },
  { field: "note", maxLength: 4 }
];
const template = () => createTemplate().page(100, 80).text("test", { leftMm: 0, topMm: 0, widthMm: 30, heightMm: 10 }).build();

describe("跨端参数与 Provider 契约", () => {
  it("合并默认值，保留旧字符串契约，同时提供匹配 JSON Schema 的规范数字值", () => {
    const result = validateReportParams(params, { date: "2024-02-29", limit: 0.2e2, extra: "kept" });
    expect(result.ok).toBe(true);
    expect(result.values).toEqual({ plant: "A", date: "2024-02-29", limit: "20", extra: "kept" });
    expect(result.typedValues.limit).toBe(20);
    expect(reportParamsJsonSchema(params)).toMatchObject({ required: ["plant", "date"], properties: { limit: { type: "number", default: 20, minimum: 1, maximum: 100 }, date: { format: "date", "x-report-minimum": "2024-01-01" } } });
  });
  it("拒绝日期溢出、非法枚举、非有限数字、范围和长度；错误包含稳定 code/path", () => {
    expect(validateReportParams(params, { date: "2025-02-29", plant: "B", limit: "Infinity", note: "12345" }).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "type", path: "$.params.date" }), expect.objectContaining({ code: "option", field: "plant" }),
      expect.objectContaining({ code: "type", field: "limit" }), expect.objectContaining({ code: "maxLength", field: "note" })
    ]));
    expect(validateReportParams(params, { date: "2027-01-01", limit: "0" }).issues.map((issue) => issue.code)).toEqual(["maximum", "minimum"]);
    expect(() => assertReportParams(params, {})).toThrow(expect.objectContaining({ code: "params", issues: expect.arrayContaining([expect.objectContaining({ code: "required", field: "date" })]) }));
  });
  it("未知类型不隐式转字符串，空选填值不污染规范 typedValues，危险键不修改原型", () => {
    expect(validateReportParams([{ field: "x" }], { x: {} }).issues[0]?.code).toBe("type");
    expect(validateReportParams([{ field: "n", type: "number" }], { n: "" }).typedValues).toEqual({});
    const input = JSON.parse('{"__proto__":"safe"}') as Record<string, unknown>;
    expect(validateReportParams([{ field: "__proto__" }], input).values.__proto__).toBe("safe");
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
  });
  it("配置本身非法也给出definition问题，不生成无效默认值或反向范围Schema", () => {
    const defs: ReportParamDef[] = [{ field: "n", type: "number", min: 10, max: 2, defaultValue: "Infinity" }];
    expect(validateReportParams(defs, {}).issues.some((issue) => issue.code === "definition")).toBe(true);
    expect(() => reportParamsJsonSchema(defs)).toThrow(expect.objectContaining({ code: "params" }));
    expect(validateReportParams([{ field: "emoji", minLength: 1, maxLength: 1 }], { emoji: "😀" }).ok).toBe(true);
  });
  it.each([null, {}, [null], [{ field: 12 }], [{ field: "x", defaultValue: 12 }],
    [{ field: "x", options: {} }], [{ field: "x", options: [null] }], [{ field: "x", options: [{ label: "A", value: 1 }] }],
    [{ field: "x", required: "yes" }], [{ field: "x", minLength: Symbol("length"), maxLength: 4, defaultValue: "A" }]
  ])("JS/JSON 非法参数配置返回结构化 definition，不抛原生 TypeError：%j", (input) => {
    const defs = input as unknown as ReportParamDef[];
    expect(validateReportParams(defs, {}).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "definition", path: expect.stringContaining("$.paramDefs") })]));
    expect(() => assertReportParams(defs, {})).toThrow(expect.objectContaining({ code: "params" }));
    expect(() => reportParamsJsonSchema(defs)).toThrow(expect.objectContaining({ code: "params" }));
  });
  it("非法参数对象也返回明确路径，元数据读取先检查配置而不直接访问 null 项", () => {
    expect(validateReportParams([], null as unknown as Record<string, unknown>)).toMatchObject({ ok: false, issues: [{ code: "type", path: "$.params" }] });
    const source = createReportSource({ a: { template: template(), params: [null] as unknown as ReportParamDef[] } });
    expect(() => source.getParamDefs(["a"])).toThrow(expect.objectContaining({ code: "params" }));
  });
  it("所有已声明参数在任何数据请求前校验，动态模板的参数在业务取数前校验", async () => {
    const load = vi.fn(() => ({}));
    const source = createReportSource({ a: { template: template(), load }, b: { template: template(), load, params: [{ field: "date", required: true }] } });
    await expect(source({ reportIds: ["a", "b"], params: {} })).rejects.toMatchObject({ code: "params" });
    expect(load).not.toHaveBeenCalled();
    const dynamic = createReportSource({ a: { template: async () => ({ ...template(), params }), load } });
    await expect(dynamic({ reportIds: ["a"], params: {} })).rejects.toMatchObject({ code: "params" });
    expect(load).not.toHaveBeenCalled();
  });
  it("Provider 统一查询传递参数、修订和诊断，旧 load 优先级保持兼容", async () => {
    const query = vi.fn(() => ({ datasets: {}, revision: "r2", sourceToken: "token", diagnostics: [] }));
    const onQueryResult = vi.fn();
    const source = createReportSource({ a: createProviderReport({ template: template(), params: [{ field: "plant", defaultValue: "A" }], provider: { query } }) });
    await source({ reportIds: ["a"], params: {}, onQueryResult });
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ params: { plant: "A" } }));
    expect(onQueryResult).toHaveBeenCalledWith("a", expect.objectContaining({ revision: "r2" }));
    query.mockClear();
    await createReportSource({ a: { template: template(), provider: { query }, load: () => ({}) } })({ reportIds: ["a"], params: {} });
    expect(query).not.toHaveBeenCalled();
  });
  it("Provider 返回错误元数据时按validate归类，不产生无效跨端响应", async () => {
    const source = createReportSource({ a: { template: template(), provider: { query: () => ({ datasets: {}, revision: 12 as unknown as string }) } } });
    await expect(source({ reportIds: ["a"], params: {} })).rejects.toMatchObject({ code: "validate", message: expect.stringContaining("revision") });
  });
  it("数据契约在分页前拒绝缺失数据集和错误类型，不将错误响应伪装成空表", async () => {
    const dataSchema = { rows: { fields: [{ field: "weight", type: "number" as const, required: true }] } };
    const absent = createReportSource({ a: { template: template(), dataSchema, load: () => ({}) } });
    await expect(absent({ reportIds: ["a"], params: {} })).rejects.toMatchObject({ code: "validate", cause: { issues: [{ code: "row", path: "$.datasets.rows" }] } });
    const invalid = createReportSource({ a: { template: template(), dataSchema, provider: { query: () => ({ datasets: { rows: [{ weight: "12.5" }] } }) } } });
    await expect(invalid({ reportIds: ["a"], params: {} })).rejects.toMatchObject({ code: "validate", cause: { issues: [{ code: "type", path: "$.datasets.rows[0].weight" }] } });
    const valid = createReportSource({ a: { template: template(), dataSchema, datasets: { rows: [{ weight: 0 }] } } });
    expect((await valid({ reportIds: ["a"], params: {} })).pages).toHaveLength(1);
  });
  it("表头合并计入已占用的跨行位置，并拒绝小JSON放大的巨大逻辑网格", () => {
    const report = createTemplate().page(100, 80).list("rows", { leftMm: 0, topMm: 0, widthMm: 80 }, [
      { field: "a", header: "A", widthMm: 40 }, { field: "b", header: "B", widthMm: 40 }
    ]).build();
    const list = report.pages[0]!.components[0]!;
    if (list.kind !== "list") throw new Error("expected list");
    list.headerGrid = { cells: [[{ text: "A", rowSpan: 2 }, { text: "B" }], [{ text: "overflow", colSpan: 2 }]] };
    expect(validateReportTemplate(report).errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("边界") })]));
    list.columns = Array.from({ length: 501 }, (_, index) => ({ field: `f${index}`, header: "", widthMm: 1 }));
    list.headerGrid = { cells: Array.from({ length: 400 }, () => []) };
    expect(validateReportTemplate(report).errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("20 万格") })]));
  });
});
