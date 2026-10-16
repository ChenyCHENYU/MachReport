// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import type { ReportTemplate } from "../layout/paginate";
import { createReportSource, defineReport, type ReportLoadContext } from "../source/report-source";
import {
  createTemplateRegistry, defineReportTemplate, parseReportTemplate, REPORT_TEMPLATE_DOCUMENT_VERSION,
  ReportTemplateError, serializeReportTemplate, validateReportTemplate, validateReportTemplateDocument,
  type ReportTemplateDocument
} from "../source/template-registry";

function template(title = "销售明细"): ReportTemplate {
  return createTableTemplate({
    title, columns: [{ header: "编号", field: "id" }, { header: "金额", field: "amount", format: { kind: "number", digits: 2 } }],
    params: [{ field: "date", type: "date", required: true }]
  });
}

function document(id = "sales"): ReportTemplateDocument {
  return defineReportTemplate({ id, name: "销售报表", revision: "v1", template: template() });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe("存储无关的模板文档与目录", () => {
  it("标准明细模板可直接创建、导出和导入，参数/格式/分组均保留", () => {
    const doc = document();
    const list = doc.template.pages[0]!.components.find((component) => component.kind === "list")!;
    if (list.kind !== "list") throw new Error("expected list");
    list.groupBy = { field: "id", subtotal: ["amount"], headerStyle: { bold: true } };
    list.grandTotal = { fields: ["amount"], label: "总计" };
    expect(doc.schemaVersion).toBe(REPORT_TEMPLATE_DOCUMENT_VERSION);
    expect(parseReportTemplate(serializeReportTemplate(doc))).toEqual(doc);
    expect(validateReportTemplateDocument(doc)).toMatchObject({ ok: true, errors: [], warnings: [] });
  });

  it("接口返回的对象直接校验为快照，使用侧无需 JSON stringify 再 parse", () => {
    const response: unknown = document();
    const parsed = parseReportTemplate(response);
    parsed.name = "编辑副本";
    expect((response as ReportTemplateDocument).name).toBe("销售报表");
    expect(() => parseReportTemplate(undefined)).toThrow(ReportTemplateError);
  });

  it("目录存入/读取均为快照，目录列表只含元数据", () => {
    const original = document();
    const registry = createTemplateRegistry([original]);
    original.name = "外部改名";
    original.template.pages[0]!.widthMm = 999;
    expect(registry.get("sales")?.name).toBe("销售报表");
    const read = registry.get("sales")!;
    read.template.pages[0]!.widthMm = 888;
    expect(registry.get("sales")?.template.pages[0]!.widthMm).toBe(210);
    expect(registry.list()).toEqual([{ schemaVersion: REPORT_TEMPLATE_DOCUMENT_VERSION, id: "sales", name: "销售报表", revision: "v1" }]);
    registry.list()[0]!.name = "列表改名";
    expect(registry.get("sales")?.name).toBe("销售报表");
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.remove("sales")).toBe(true);
    expect(registry.remove("sales")).toBe(false);
  });

  it("重复 ID 默认拒绝，显式替换更新版本；初始文档也遵守同一规则", () => {
    const registry = createTemplateRegistry([document()]);
    const updated = document();
    updated.revision = "v2";
    expect(() => registry.register(updated)).toThrow(/replace:true/);
    expect(registry.get("sales")?.revision).toBe("v1");
    registry.register(updated, { replace: true });
    expect(registry.get("sales")?.revision).toBe("v2");
    expect(() => createTemplateRegistry([document(), document()])).toThrow(ReportTemplateError);
  });

  it("特殊 ID 作为 Map 键安全存取，不通过对象原型查找", () => {
    const registry = createTemplateRegistry([document("__proto__"), document("constructor")]);
    expect(registry.get("__proto__")?.id).toBe("__proto__");
    expect(registry.get("toString")).toBeUndefined();
    expect(registry.list()).toHaveLength(2);
  });

  it.each([undefined, "2.0", "1.0.0-mach"])("拒绝未知/缺失文档版本 %s", (version) => {
    const raw = { ...document(), schemaVersion: version };
    expect(validateReportTemplateDocument(raw).ok).toBe(false);
    expect(() => parseReportTemplate(JSON.stringify(raw))).toThrow(/schemaVersion/);
  });

  it.each(["", "{", "null", "[]"])("非法 JSON/根对象 %j 返回可定位错误", (json) => {
    expect(() => parseReportTemplate(json)).toThrow(ReportTemplateError);
  });

  it.each(["id", "name"])("空白 %s 不得存入目录", (key) => {
    const invalid = { ...document(), [key]: "  " };
    expect(() => createTemplateRegistry([invalid])).toThrow(new RegExp(`\\$.${key}`));
  });

  it("拒绝原型污染键、函数、特殊对象和非有限数字", () => {
    const base = document();
    const unsafe = JSON.parse(serializeReportTemplate(base).replace('"name": "销售报表"', '"name": "销售报表", "__proto__": { "polluted": true }'));
    expect(() => parseReportTemplate(JSON.stringify(unsafe))).toThrow(/污染原型/);
    for (const extra of [() => "execute", new Date(), Infinity, undefined, Symbol("x")]) {
      expect(validateReportTemplateDocument({ ...base, extra }).ok).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("拒绝循环引用与访问器，校验不触发访问器", () => {
    const cycle: Record<string, unknown> = { ...document() };
    cycle.cycle = cycle;
    expect(validateReportTemplateDocument(cycle).errors[0]?.message).toContain("循环");
    const getter = vi.fn(() => "not called");
    const accessor = { ...document() };
    Object.defineProperty(accessor, "secret", { enumerable: true, get: getter });
    expect(validateReportTemplateDocument(accessor).ok).toBe(false);
    expect(() => defineReportTemplate(accessor)).toThrow(ReportTemplateError);
    expect(getter).not.toHaveBeenCalled();
  });

  it("稀疏数组和未知文档根字段不得在 JSON 序列化中静默变形", () => {
    const doc = document();
    doc.template.pages[0]!.components = new Array(1);
    expect(validateReportTemplateDocument(doc).errors[0]?.message).toContain("空位");
    expect(validateReportTemplateDocument({ ...document(), datasets: { detail: [] } }).errors).toContainEqual(expect.objectContaining({ path: "$.datasets" }));
  });

  it("异常深度有界拒绝，避免导入递归溢出", () => {
    const doc: Record<string, unknown> = { ...document() };
    let value = doc;
    for (let i = 0; i < 70; i++) { const next = {}; value.extra = next; value = next; }
    expect(validateReportTemplateDocument(doc).errors.some((error) => error.message.includes("层级"))).toBe(true);
  });

  it("几何、参数、列格式和样式错误在导入阶段定位，不需取数分页", () => {
    const doc = document();
    doc.template.pages[0]!.marginLeftMm = 210;
    doc.template.params!.push({ field: "date", type: "date" });
    const list = doc.template.pages[0]!.components.find((component) => component.kind === "list")!;
    if (list.kind !== "list") throw new Error("expected list");
    list.columns[0]!.widthMm = 0;
    list.columns[1]!.format = { kind: "number", digits: -1 };
    list.columns[0]!.style = { align: "invalid" as "left" };
    const result = validateReportTemplateDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.path)).toEqual(expect.arrayContaining([
      "$.template.pages.0", "$.template.params.1.field",
      "$.template.pages.0.components.1.columns.0.widthMm",
      "$.template.pages.0.components.1.columns.1.format.digits",
      "$.template.pages.0.components.1.columns.0.style.align"
    ]));
    expect(() => serializeReportTemplate(doc)).toThrow(ReportTemplateError);
  });

  it("允许空白表头，并保留未知静态组件的既有兜底告警", () => {
    const value = template();
    const list = value.pages[0]!.components[1]!;
    if (list.kind !== "list") throw new Error("expected list");
    list.columns[0]!.header = "";
    expect(validateReportTemplate(value).ok).toBe(true);
    value.pages[0]!.components.push({ kind: "future-kind" as "text", leftMm: 1, topMm: 1, widthMm: 10, heightMm: 10 });
    expect(validateReportTemplate(value)).toMatchObject({ ok: true, warnings: [expect.objectContaining({ path: "$.pages.0.components.2.kind" })] });
  });
});

describe("动态模板接入统一数据源", () => {
  it.each(["template", "data"] as const)("%s 异步等待期间宿主修改 IDs/参数，不改变已发起请求的报表与取数口径", async (phase) => {
    const pendingTemplate = deferred<ReportTemplate>();
    const pendingData = deferred<{ detail: { id: string; amount: number }[] }>();
    const seen: ReportLoadContext[] = [];
    const secondLoad = vi.fn((context: ReportLoadContext) => {
      seen.push(context);
      return { detail: [{ id: "second", amount: 2 }] };
    });
    const source = createReportSource({
      first: {
        template: phase === "template" ? () => pendingTemplate.promise : template("第一张"),
        load: (context) => { seen.push(context); return phase === "data" ? pendingData.promise : { detail: [{ id: "first", amount: 1 }] }; }
      },
      second: { template: template("第二张"), load: secondLoad }
    });
    const ids = ["first", "second"];
    const params = { date: "2026-10-15" };
    const pending = source({ reportIds: ids, params });
    ids[0] = "changed-first";
    ids[1] = "changed-second";
    params.date = "2026-10-16";
    if (phase === "template") pendingTemplate.resolve(template("第一张"));
    else pendingData.resolve({ detail: [{ id: "first", amount: 1 }] });
    const plan = await pending;
    expect(seen.map((context) => ({ reportId: context.reportId, params: context.params }))).toEqual([
      { reportId: "first", params: { date: "2026-10-15" } },
      { reportId: "second", params: { date: "2026-10-15" } }
    ]);
    expect(secondLoad).toHaveBeenCalledOnce();
    expect(plan.pages.map((page) => page.components[0]!.text)).toEqual(["第一张", "第二张"]);
  });

  it("旧静态 runtime 模板的显式 undefined 可选属性仍然兼容", async () => {
    const value = template();
    const title = value.pages[0]!.components[0]!;
    if (title.kind === "list") throw new Error("expected text title");
    title.style = { color: undefined };
    const source = createReportSource({ sales: { template: value, datasets: { detail: [] } } });
    expect((await source({ reportIds: ["sales"], params: { date: "2026-10-16" } })).pages[0]!.components[0]!.text).toBe("销售明细");
    expect(validateReportTemplateDocument({ ...document(), template: value }).ok).toBe(false);
  });
  it("模板加载与取数共用上下文，仍支持 defineReport 字段映射和声明式参数", async () => {
    const seen: ReportLoadContext[] = [];
    const dynamic = vi.fn((context: ReportLoadContext) => { seen.push(context); return Promise.resolve(template()); });
    const source = createReportSource({ sales: defineReport({
      template: dynamic, params: [{ field: "date", type: "date" }],
      load: (context) => { seen.push(context); return { items: [{ code: "0001", total: 12.5 }] }; },
      mapData: (data, context) => { seen.push(context); return { detail: data.items.map((item) => ({ id: item.code, amount: item.total })) }; }
    }) });
    expect(source.getParamDefs(["sales"])).toEqual([{ field: "date", type: "date" }]);
    expect(dynamic).not.toHaveBeenCalled();
    const controller = new AbortController();
    const plan = await source({ reportIds: ["sales"], params: { date: "2026-10-15" }, signal: controller.signal });
    expect(seen).toHaveLength(3);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[1]).toBe(seen[2]);
    expect(seen[0]).toEqual({ reportId: "sales", params: { date: "2026-10-15" }, signal: controller.signal });
    expect(plan.pages[0]!.components.flatMap((component) => component.grid?.cells.flatMap((row) => row.map((cell) => cell?.text)) ?? [])).toContain("12.50");
  });

  it("目录版本替换后下一次查询使用新模板，业务数据和模板均不隐式缓存", async () => {
    const registry = createTemplateRegistry([document()]);
    const load = vi.fn(() => ({ detail: [{ id: "1", amount: 20 }] }));
    const dynamic = vi.fn(() => registry.get("sales")!.template);
    const source = createReportSource({ sales: { template: dynamic, load } });
    const first = await source({ reportIds: ["sales"], params: { date: "2026-10-16" } });
    registry.register(defineReportTemplate({ id: "sales", name: "新版", revision: "v2", template: template("新版标题") }), { replace: true });
    const second = await source({ reportIds: ["sales"], params: { date: "2026-10-16" } });
    expect(first.pages[0]!.components[0]!.text).toBe("销售明细");
    expect(second.pages[0]!.components[0]!.text).toBe("新版标题");
    expect(dynamic).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect(source.getParamDefs(["sales"])).toEqual([]);
  });

  it("动态模板非法时在取数前拒绝，保留可定位模板错误", async () => {
    const load = vi.fn(() => ({ detail: [] }));
    const source = createReportSource({ sales: { template: () => ({ pages: [] }), load } });
    await expect(source({ reportIds: ["sales"], params: {} })).rejects.toMatchObject({ code: "validate", message: expect.stringContaining("$.pages") });
    expect(load).not.toHaveBeenCalled();
  });

  it("远程 JSON 导入失败以 validate 分类上报，不混同网络请求失败", async () => {
    const source = createReportSource({ sales: { template: () => parseReportTemplate("{}").template } });
    await expect(source({ reportIds: ["sales"], params: {} })).rejects.toMatchObject({ code: "validate", cause: expect.any(ReportTemplateError) });
  });

  it.each(["sync", "async"])("%s 模板加载异常保留 ID 和 cause", async (mode) => {
    const cause = new Error("template endpoint unavailable");
    const load = vi.fn(() => ({ detail: [] }));
    const source = createReportSource({ sales: { template: () => { if (mode === "sync") throw cause; return Promise.reject(cause); }, load } });
    await expect(source({ reportIds: ["sales"], params: {} })).rejects.toMatchObject({ code: "fetch", cause, message: expect.stringContaining("sales 模板加载失败") });
    expect(load).not.toHaveBeenCalled();
  });

  it("模板 loader 忽略 signal 也及时取消，迟到结果不取数/分页/告警", async () => {
    const late = deferred<ReportTemplate>();
    const controller = new AbortController();
    const load = vi.fn(() => ({ detail: [] }));
    const warn = vi.fn();
    const source = createReportSource({ sales: { template: () => late.promise, load } }, { onWarning: warn });
    const pending = source({ reportIds: ["sales"], params: {}, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    late.resolve(template());
    await late.promise;
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
