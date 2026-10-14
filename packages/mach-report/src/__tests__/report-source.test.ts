// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTemplate } from "../builder/template-builder";
import type { DatasetRows, ReportParamDef, ReportTemplate } from "../layout/paginate";
import { RENDER_PLAN_SCHEMA_VERSION, type RenderPlan } from "../schema/render-plan";
import { getReportParamDefs } from "../source/report-params";
import {
  createReportSource,
  defineReport,
  ReportSourceError,
  type ReportFetcher,
  type ReportLoadContext,
  type ReportRegistry
} from "../source/report-source";
import type { PlanFetcher } from "../vue/adapters";

function template(title = "销售明细", params: ReportParamDef[] = []): ReportTemplate {
  return createTemplate()
    .params(params)
    .page(120, 80)
    .text(title, { leftMm: 10, topMm: 2, widthMm: 100, heightMm: 6 })
    .list("detail", { leftMm: 10, topMm: 12, widthMm: 100 }, [
      { header: "编号", field: "id", widthMm: 25 },
      { header: "名称", field: "name", widthMm: 75 }
    ])
    .build();
}

function cellTexts(plan: RenderPlan): string[] {
  return plan.pages.flatMap((page) => page.components.flatMap((component) =>
    component.grid?.cells.flatMap((row) => row.map((cell) => cell?.text ?? "")) ?? []
  ));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("框架无关报表数据源", () => {
  afterEach(() => vi.restoreAllMocks());

  it("远程取数透传参数与取消信号，包内真实分页保留不等宽列", async () => {
    const controller = new AbortController();
    const params = { warehouse: "W1", date: "2026-10-14" };
    const load = vi.fn(async (context: ReportLoadContext) => {
      expect(context).toEqual({ reportId: "sales", params, signal: controller.signal });
      expect(context.params).not.toBe(params);
      return { detail: [{ id: "A-1", name: "销售明细" }, { id: "A-2", name: "第二行" }] };
    });
    const source = createReportSource({ sales: { template: template(), load } });
    const plan = await source({ reportIds: ["sales"], params, signal: controller.signal });
    expect(load).toHaveBeenCalledOnce();
    expect(plan.schemaVersion).toBe(RENDER_PLAN_SCHEMA_VERSION);
    expect(plan.pages).toHaveLength(1);
    expect(cellTexts(plan)).toEqual(["编号", "名称", "A-1", "销售明细", "A-2", "第二行"]);
    const grids = plan.pages[0]!.components.filter((component) => component.grid);
    expect(grids).toHaveLength(3);
    for (const grid of grids) expect(grid.grid?.colWidthsMm).toEqual([25, 75]);
  });

  it("静态数据直接排版；配置 load 后优先使用新数据", async () => {
    const datasets = { detail: [{ id: "static", name: "静态数据" }] };
    const staticSource = createReportSource({ sales: defineReport({ template: template(), datasets }) });
    expect(cellTexts(await staticSource({ reportIds: ["sales"], params: {} }))).toContain("static");
    const load = vi.fn(() => ({ detail: [{ id: "remote", name: "远程数据" }] }));
    const remoteSource = createReportSource({ sales: { template: template(), datasets, load } });
    const plan = await remoteSource({ reportIds: ["sales"], params: {} });
    expect(cellTexts(plan)).toContain("remote");
    expect(cellTexts(plan)).not.toContain("static");
    expect(datasets.detail).toEqual([{ id: "static", name: "静态数据" }]);
  });

  it("defineReport 推导业务响应并映射字段，mapper 与 loader 使用同一上下文", async () => {
    const seen: ReportLoadContext[] = [];
    const definition = defineReport({
      template: template(),
      load: async (context) => {
        seen.push(context);
        return { data: { items: [{ code: "SKU-9", displayName: "业务包装响应" }] } };
      },
      mapData: (response, context) => {
        seen.push(context);
        return { detail: response.data.items.map((item) => ({ id: item.code, name: item.displayName })) };
      }
    });
    const source = createReportSource({ inventory: definition });
    expect(cellTexts(await source({ reportIds: ["inventory"], params: { warehouse: "W2" } })))
      .toContain("业务包装响应");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toMatchObject({ reportId: "inventory", params: { warehouse: "W2" } });
  });

  it("mapper 异常归为 validate 错误，保留报表 ID 和原始 cause", async () => {
    const cause = new Error("unexpected business response");
    const source = createReportSource({ inventory: defineReport({
      template: template(),
      load: async () => ({ items: [] }),
      mapData: () => { throw cause; }
    }) });
    await expect(source({ reportIds: ["inventory"], params: {} })).rejects.toMatchObject({
      name: "ReportSourceError", code: "validate", cause,
      message: expect.stringContaining("inventory 数据映射失败")
    });
  });

  it("按调用方 reportId 顺序合并完整页面，各报表参数上下文互不污染", async () => {
    const params = { original: "yes" };
    const calls: string[] = [];
    const source = createReportSource({
      first: {
        template: template("第一张报表"),
        load: (context) => {
          calls.push(context.reportId);
          expect(context.params).toEqual(params);
          return { detail: [{ id: "first", name: "首份数据" }] };
        }
      },
      second: {
        template: template("第二张报表"),
        load: (context) => {
          calls.push(context.reportId);
          context.params.original = "mutated";
          return { detail: Array.from({ length: 20 }, (_, i) => ({ id: `second-${i}`, name: "多页数据" })) };
        }
      }
    });
    const plan = await source({ reportIds: ["second", "first"], params });
    expect(calls).toEqual(["second", "first"]);
    expect(plan.pages.length).toBeGreaterThan(2);
    expect(plan.pages[0]!.components[0]!.text).toBe("第二张报表");
    expect(plan.pages[plan.pages.length - 1]!.components[0]!.text).toBe("第一张报表");
    expect(cellTexts(plan)).toContain("second-19");
    const texts = cellTexts(plan);
    expect(texts[texts.length - 2]).toBe("first");
    expect(params).toEqual({ original: "yes" });
  });

  it.each(["missing", "toString", "__proto__", "constructor"])("未注册 %s 在所有取数之前报错", async (missing) => {
    const load = vi.fn(() => ({ detail: [] }));
    const source = createReportSource({ valid: { template: template(), load } });
    await expect(source({ reportIds: ["valid", missing], params: {} })).rejects.toMatchObject({
      name: "ReportSourceError", code: "config", message: `未注册报表 ${missing}`
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("空报表 ID 列表不会取数", async () => {
    const load = vi.fn(() => ({ detail: [] }));
    await expect(createReportSource({ valid: { template: template(), load } })({ reportIds: [], params: {} }))
      .rejects.toMatchObject({ code: "config" });
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    null, [], { detail: "rows" }, { detail: ["row"] }, { detail: [null] }, { detail: [[]] }
  ])("非法数据集 %j 给出 validate 错误", async (value) => {
    const source = createReportSource({ invalid: {
      template: template(), load: () => value as unknown as DatasetRows
    } });
    await expect(source({ reportIds: ["invalid"], params: {} })).rejects.toMatchObject({
      name: "ReportSourceError", code: "validate"
    });
  });

  it("排版结果非法时拒绝返回，保留可定位的计划路径", async () => {
    const invalid = template();
    invalid.pages[0]!.components[0]!.widthMm = Number.NaN;
    const warn = vi.fn();
    const source = createReportSource({ broken: { template: invalid, datasets: { detail: [] } } }, { onWarning: warn });
    const error = await source({ reportIds: ["broken"], params: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReportSourceError);
    expect(error).toMatchObject({ code: "validate" });
    expect((error as Error).message).toContain("$.pages.0.components.0.widthMm");
    expect(warn).not.toHaveBeenCalled();
  });

  it("模板排版异常包装为 validate 错误并保留 cause", async () => {
    const source = createReportSource({ broken: { template: { pages: null } as unknown as ReportTemplate } });
    await expect(source({ reportIds: ["broken"], params: {} })).rejects.toMatchObject({
      code: "validate", cause: expect.any(TypeError)
    });
  });

  it.each(["sync", "async"])("%s loader 错误包含 reportId、fetch code 和原始 cause", async (mode) => {
    const cause = new Error("gateway unavailable");
    const source = createReportSource({ orders: {
      template: template(),
      load: () => { if (mode === "sync") throw cause; return Promise.reject(cause); }
    } });
    await expect(source({ reportIds: ["orders"], params: {} })).rejects.toMatchObject({
      name: "ReportSourceError", code: "fetch", cause, message: expect.stringContaining("orders")
    });
  });

  it("旧 PlanFetcher 签名仍可赋给新契约，数据源也可供旧调用侧直接使用", async () => {
    const old: PlanFetcher = async ({ reportIds, params }) => ({
      schemaVersion: RENDER_PLAN_SCHEMA_VERSION,
      pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{
        kind: "text", leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10,
        text: `${reportIds[0]}:${params.code}`
      }] }]
    });
    const compatible: ReportFetcher = old;
    expect((await compatible({ reportIds: ["legacy"], params: { code: "9" } })).pages[0]!.components[0]!.text)
      .toBe("legacy:9");
    const oldConsumer: PlanFetcher = createReportSource({ sales: { template: template(), datasets: { detail: [] } } });
    expect((await oldConsumer({ reportIds: ["sales"], params: {} })).pages).toHaveLength(1);
  });

  it("模板参数取有序并集，同名使用首个报表，定义级 params 完整覆写模板参数", () => {
    const load = vi.fn(() => ({ detail: [] }));
    const reports: ReportRegistry = {
      first: { template: template("A", [
        { field: "date", label: "首份日期", type: "date" }, { field: "warehouse", type: "select" }
      ]), load },
      second: { template: template("B", [{ field: "ignored" }]), params: [
        { field: "date", label: "第二份日期" }, { field: "category", type: "text" }
      ], load },
      none: { template: template("C", [{ field: "cleared" }]), params: [], load }
    };
    const source = createReportSource(reports);
    expect(source.getParamDefs?.(["first", "second", "first", "none"])).toEqual([
      { field: "date", label: "首份日期", type: "date" },
      { field: "warehouse", type: "select" }, { field: "category", type: "text" }
    ]);
    expect(getReportParamDefs(reports, ["second", "first"])[0]).toEqual({ field: "date", label: "第二份日期" });
    expect(source.getParamDefs?.(["missing", "toString", "__proto__", "constructor", "none"])).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("调用级告警通道优先于数据源配置；未传时使用配置", async () => {
    const configured = vi.fn();
    const perCall = vi.fn();
    const source = createReportSource({ empty: { template: template() } }, { onWarning: configured });
    await source({ reportIds: ["empty"], params: {}, onWarning: perCall });
    expect(perCall).toHaveBeenCalledWith(expect.stringContaining("empty: 数据集 detail"));
    expect(configured).not.toHaveBeenCalled();
    await source({ reportIds: ["empty"], params: {} });
    expect(configured).toHaveBeenCalledWith(expect.stringContaining("empty: 数据集 detail"));
  });

  it("预先取消时保留 reason，且不取数、不排版、不发告警", async () => {
    const controller = new AbortController();
    const reason = new Error("left page");
    controller.abort(reason);
    const load = vi.fn(() => ({ detail: [] }));
    const warn = vi.fn();
    const source = createReportSource({ sales: { template: template(), load } }, { onWarning: warn });
    await expect(source({ reportIds: ["sales"], params: {}, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError", cause: reason
    });
    expect(load).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("loader 忽略 signal 时调用仍及时取消，迟到结果不触发排版、后续取数和告警", async () => {
    const controller = new AbortController();
    const late = deferred<DatasetRows>();
    const cancelledTemplate = template();
    const pages = cancelledTemplate.pages;
    const readPages = vi.fn(() => pages);
    Object.defineProperty(cancelledTemplate, "pages", { get: readPages });
    const first = vi.fn(() => late.promise);
    const next = vi.fn(() => ({ detail: [] }));
    const warn = vi.fn();
    const source = createReportSource({
      first: { template: cancelledTemplate, load: first },
      next: { template: template(), load: next }
    }, { onWarning: warn });
    const pending = source({ reportIds: ["first", "next"], params: {}, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(first).toHaveBeenCalledOnce();
    controller.abort();
    await rejected;
    expect(readPages).not.toHaveBeenCalled();
    late.resolve({}); // 若错误地继续排版，会产生缺失 detail 的告警。
    await late.promise;
    await Promise.resolve();
    expect(readPages).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("defineReport 的 loader 忽略取消时，迟到结果也不会执行业务 mapper", async () => {
    const controller = new AbortController();
    const late = deferred<{ items: { code: string; label: string }[] }>();
    const mapData = vi.fn((data: { items: { code: string; label: string }[] }) => ({
      detail: data.items.map((item) => ({ id: item.code, name: item.label }))
    }));
    const warn = vi.fn();
    const source = createReportSource({ inventory: defineReport({
      template: template(), load: () => late.promise, mapData
    }) }, { onWarning: warn });
    const pending = source({ reportIds: ["inventory"], params: {}, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    late.resolve({ items: [{ code: "late", label: "迟到响应" }] });
    await late.promise;
    await Promise.resolve();
    expect(mapData).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["success", "reject", "abort"])("%s 路径清理取消监听", async (mode) => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const data = deferred<DatasetRows>();
    const source = createReportSource({ sales: { template: template(), load: () => data.promise } });
    const pending = source({ reportIds: ["sales"], params: {}, signal: controller.signal });
    const settled = pending.catch(() => undefined);
    if (mode === "success") data.resolve({ detail: [] });
    else if (mode === "reject") data.reject(new Error("offline"));
    else controller.abort();
    await settled;
    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
    expect(remove).toHaveBeenCalledOnce();
    if (mode === "abort") data.resolve({ detail: [] });
  });
});
