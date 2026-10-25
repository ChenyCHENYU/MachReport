// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createReportComponentRegistry, ReportComponentExtensionError, type ReportComponentExtensionDefinition, type ReportComponentExtensionContext } from "../output/component-registry";
import { resolvePlanAssets } from "../output/assets";
import { renderPlanToPdf } from "../pdf/render-pdf";
import { renderPlanToXlsx } from "../xlsx/render-xlsx";
import ExcelJS from "exceljs";
import { createReportRuntime } from "../server/runtime";
import { reviewReportPublication } from "../server/publication";
import { defineReportTemplate } from "../source/template-registry";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const geometry = { leftMm: 5, topMm: 5, widthMm: 20, heightMm: 10 };
function definition(id = "business.stamp"): ReportComponentExtensionDefinition {
  return { id, version: "1.0.0", kind: "image", label: "Business stamp", description: "Trusted host extension", properties: {
    caption: { type: "string", label: "Caption", required: true, default: "Approved", maxLength: 30 },
    count: { type: "number", label: "Count", min: 0, max: 10, default: 0 },
    show: { type: "boolean", label: "Show", default: false },
    color: { type: "string", label: "Color", options: ["blue", "red"] },
  }, load: () => ({ render: () => PNG }) };
}
function plan(...components: PlanComponent[]): RenderPlan { return { schemaVersion: "1.0.0", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components }] }; }

describe("explicit component extensions", () => {
  it("shares one lazy loader, dispatches multiple same-kind extensions, and leaves native assets on their existing path", async () => {
    const first = definition(), render = vi.fn((_context: ReportComponentExtensionContext) => PNG), load = vi.fn(() => ({ render, dispose: vi.fn() })); first.load = load;
    const second = definition("business.logo"), secondRender = vi.fn(() => PNG); second.load = () => ({ render: secondRender });
    const registry = createReportComponentRegistry([first, second]);
    expect(load).not.toHaveBeenCalled();
    const component = { ...registry.createComponent(first.id, { binding: { dataset: "approval", rowKey: "001", values: [0, false, null] } }), ...geometry };
    const native = { kind: "image" as const, ...geometry };
    const fallback = vi.fn(() => PNG);
    const [one, two] = await Promise.all([resolvePlanAssets(plan(component, { ...registry.createComponent(second.id), ...geometry }, native), { ...registry.assets, assetRenderers: { image: fallback } }), resolvePlanAssets(plan(component), registry.assets)]);
    expect(load).toHaveBeenCalledOnce(); expect(render).toHaveBeenCalledTimes(2); expect(secondRender).toHaveBeenCalledOnce(); expect(fallback).toHaveBeenCalledOnce();
    expect(one.plan.pages[0]!.components.every(component => component.imageData === PNG)).toBe(true);
    expect(two.plan.pages[0]!.components[0]!.imageData).toBe(PNG); expect(component).not.toHaveProperty("imageData");
    const context = render.mock.calls[0]![0];
    expect(context.extension.props).toEqual({ caption: "Approved", count: 0, show: false });
    expect(context.extension.binding).toMatchObject({ rowKey: "001", values: [0, false, null] });
    expect(Object.isFrozen(context.extension.props)).toBe(true);
    expect(registry.describe("chart")).toEqual([]); expect(registry.describe("image")).toHaveLength(2);
    const current = registry.describe()[0]!;
    expect(Object.isFrozen(current.properties!.caption)).toBe(true); expect(current).not.toHaveProperty("load");
    await registry.dispose(); expect(registry.hasExtension(first.id, "1.0.0", "image")).toBe(false);
  });

  it("uses the same assets option for Node Runtime prepare and strict PDF output", async () => {
    const render = vi.fn(() => PNG), spec = definition(); spec.load = () => ({ render });
    const registry = createReportComponentRegistry([spec]);
    const component = { ...registry.createComponent(spec.id), ...geometry };
    const runtime = createReportRuntime({ reports: { report: { template: { pages: [{ widthMm: 100, heightMm: 100, components: [component] }] }, datasets: {} } }, assets: registry.assets });
    try {
      const prepared = await runtime.prepare({ reportIds: ["report"] });
      expect(prepared.plan.pages[0]!.components[0]!.imageData).toBe(PNG);
      const pdf = await renderPlanToPdf(prepared.plan, { ...registry.assets, fidelity: "strict" });
      expect(pdf.pageErrors).toEqual([]); expect(pdf.diagnostics).toEqual([]); expect(pdf.bytes.byteLength).toBeGreaterThan(800);
      expect(render).toHaveBeenCalledOnce();
    } finally { await registry.dispose(); }
  });

  it("resolves a raw registered component in direct strict XLSX output and retains its native image drawing", async () => {
    const registry = createReportComponentRegistry([definition()]);
    try {
      const result = await renderPlanToXlsx(plan({ ...registry.createComponent("business.stamp"), ...geometry }), { ...registry.assets, fidelity: "strict", paperSize: "a4" });
      expect(result.diagnostics).toEqual([]);
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.buffer);
      expect(workbook.worksheets[0]!.getImages()).toHaveLength(1);
      expect(workbook.getImage(Number(workbook.worksheets[0]!.getImages()[0]!.imageId))!.extension).toBe("png");
    } finally { await registry.dispose(); }
  });

  it("defers publication only for an exact registered identity, keeping an unbound component of the same kind blocked", async () => {
    const spec = definition(), load = vi.fn(spec.load); spec.load = load;
    const registry = createReportComponentRegistry([spec]), component = { ...registry.createComponent(spec.id), ...geometry };
    const document = (components: PlanComponent[]) => defineReportTemplate({ id: "publish", name: "Publish", template: { pages: [{ widthMm: 100, heightMm: 100, components }] } });
    try {
      const options = { fixtures: [{ name: "explicit", datasets: {} }], formats: ["pdf"] as const, strictOutputs: true, pdf: registry.assets };
      const blocked = await reviewReportPublication(document([component, { kind: "image", ...geometry }]), { ...options, formats: [...options.formats] });
      expect(blocked.ok).toBe(false); expect(blocked.artifacts).toEqual([]); expect(load).not.toHaveBeenCalled();
      const valid = await reviewReportPublication(document([component]), { ...options, formats: [...options.formats] });
      expect(valid.ok, JSON.stringify(valid.issues)).toBe(true); expect(valid.artifacts).toHaveLength(1); expect(load).toHaveBeenCalledOnce();
    } finally { await registry.dispose(); }
  });

  it("validates imported bindings before loading and reports source location through asset diagnostics", async () => {
    const spec = definition(), load = vi.fn(spec.load); spec.load = load;
    const registry = createReportComponentRegistry([spec]);
    for (const extension of [
      { id: "business.unknown", version: "1.0.0", props: {} },
      { id: spec.id, version: "2.0.0", props: {} },
      { id: spec.id, version: "1.0.0", props: { count: 11 } },
      { id: spec.id, version: "1.0.0", props: { unknown: "x" } },
    ]) {
      const result = await resolvePlanAssets(plan({ kind: "image", ...geometry, meta: { componentExtension: extension } }), { ...registry.assets, assetFailure: "placeholder" });
      expect(result.diagnostics[0]).toMatchObject({ code: "asset-render-failed", pageIndex: 0, componentIndex: 0, componentPath: [] });
    }
    await expect(resolvePlanAssets(plan({ kind: "chart", ...geometry, meta: registry.createComponent(spec.id).meta }), registry.assets)).rejects.toMatchObject({ cause: { code: "binding" } });
    expect(load).not.toHaveBeenCalled();
    expect(() => registry.createComponent("unknown")).toThrow(ReportComponentExtensionError);
    expect(() => registry.createComponent(spec.id, { props: { count: "2" } })).toThrow(/number/);
    expect(() => registry.createComponent(spec.id, { props: { caption: "x".repeat(31) } })).toThrow(/maxLength/);
    expect(() => registry.createComponent(spec.id, { props: { color: "green" } })).toThrow(/options/);
    await registry.dispose();
  });

  it("does not cancel a shared loader when one consumer is cancelled and releases its renderer once", async () => {
    let finish!: (renderer: { render: () => string; dispose: () => void }) => void;
    const spec = definition(), load = vi.fn(() => new Promise<{ render: () => string; dispose: () => void }>(resolve => { finish = resolve; })); spec.load = load;
    const registry = createReportComponentRegistry([spec]), controller = new AbortController();
    const component = { ...registry.createComponent(spec.id), ...geometry };
    const aborted = resolvePlanAssets(plan(component), { ...registry.assets, signal: controller.signal });
    const active = resolvePlanAssets(plan(component), registry.assets);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    controller.abort(new Error("cancelled consumer")); await expect(aborted).rejects.toThrow("cancelled consumer");
    const dispose = vi.fn(); finish({ render: () => PNG, dispose });
    expect((await active).plan.pages[0]!.components[0]!.imageData).toBe(PNG);
    await Promise.all([registry.dispose(), registry.dispose()]); expect(dispose).toHaveBeenCalledOnce();
  });

  it("aborts consumers promptly and cleans up a loader that finishes after disposal", async () => {
    let finish!: (renderer: { render: () => string; dispose: () => void }) => void;
    const spec = definition(); spec.load = () => new Promise(resolve => { finish = resolve; });
    const registry = createReportComponentRegistry([spec]);
    const pending = resolvePlanAssets(plan({ ...registry.createComponent(spec.id), ...geometry }), registry.assets);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await registry.dispose(); await expect(pending).rejects.toMatchObject({ cause: { code: "disposed" } });
    const dispose = vi.fn(); finish({ render: () => PNG, dispose });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(() => registry.describe()).toThrow(/disposed/); expect(() => registry.createComponent(spec.id)).toThrow(/disposed/);
  });

  it("allows an explicit retry after loader failure and surfaces disposal failures", async () => {
    const spec = definition(), dispose = vi.fn(() => { throw new Error("release failed"); });
    const load = vi.fn().mockRejectedValueOnce(new Error("load failed")).mockResolvedValue({ render: () => PNG, dispose }); spec.load = load;
    const registry = createReportComponentRegistry([spec]), component = { ...registry.createComponent(spec.id), ...geometry };
    await expect(resolvePlanAssets(plan(component), registry.assets)).rejects.toMatchObject({ cause: { code: "load", cause: { message: "load failed" } } });
    await resolvePlanAssets(plan(component), registry.assets); expect(load).toHaveBeenCalledTimes(2);
    await expect(registry.dispose()).rejects.toThrow("release failed"); expect(dispose).toHaveBeenCalledOnce();
    const invalid = definition(); invalid.load = () => ({ render: undefined } as never);
    const bad = createReportComponentRegistry([invalid]);
    await expect(resolvePlanAssets(plan({ ...bad.createComponent(invalid.id), ...geometry }), bad.assets)).rejects.toMatchObject({ cause: { code: "load" } });
    await bad.dispose();
  });

  it("releases invalid loaded modules once while preserving their primary contract error", async () => {
    for (const cleanup of [() => undefined, () => { throw new Error("cleanup failure"); }, () => new Promise<void>(() => {})]) {
      const spec = definition(), dispose = vi.fn(cleanup); spec.load = () => ({ render: undefined, dispose } as never);
      const registry = createReportComponentRegistry([spec]);
      await expect(resolvePlanAssets(plan({ ...registry.createComponent(spec.id), ...geometry }), registry.assets)).rejects.toMatchObject({ cause: { code: "load", message: "Component loader must return render and optional dispose methods." } });
      expect(dispose).toHaveBeenCalledOnce();
      await registry.dispose(); expect(dispose).toHaveBeenCalledOnce();
    }
  });

  it("strict XLSX and prepared Runtime reject asset degradation even when a component has a fallback grid", async () => {
    const spec = definition(); spec.load = () => ({ render: () => { throw new Error("cannot render stamp"); } });
    const registry = createReportComponentRegistry([spec]);
    const component = { ...registry.createComponent(spec.id), ...geometry, grid: { cells: [[{ text: "fallback" }]], colWidthsMm: [20], rowHeightsMm: [10] } };
    try {
      await expect(renderPlanToXlsx(plan(component), { ...registry.assets, assetFailure: "placeholder", fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity", diagnostics: [expect.objectContaining({ code: "asset-render-failed" })] });
      const runtime = createReportRuntime({ reports: { A: { template: { pages: [{ widthMm: 100, heightMm: 100, components: [component] }] }, datasets: {} } }, assets: { ...registry.assets, assetFailure: "placeholder" } });
      const prepared = await runtime.prepare({ reportIds: ["A"] });
      expect(prepared.diagnostics).toContainEqual(expect.objectContaining({ code: "asset-render-failed" }));
      await expect(runtime.exportPrepared({ prepared, format: "xlsx", fidelity: "strict" })).rejects.toThrow(/资产渲染降级/);
      const tolerant = await renderPlanToXlsx(plan(component), { ...registry.assets, assetFailure: "placeholder", fidelity: "warn" });
      expect(tolerant.diagnostics).toContainEqual(expect.objectContaining({ code: "asset-render-failed" }));
    } finally { await registry.dispose(); }
  });

  it("rejects executable metadata and opaque bindings without invoking accessors or toJSON", () => {
    const getter = vi.fn(() => "executed"), spec = definition();
    Object.defineProperty(spec, "description", { get: getter, enumerable: true });
    expect(() => createReportComponentRegistry([spec])).toThrow(/accessor/); expect(getter).not.toHaveBeenCalled();
    const loader = definition(); Object.defineProperty(loader, "load", { get: getter });
    expect(() => createReportComponentRegistry([loader])).toThrow(/loader/); expect(getter).not.toHaveBeenCalled();
    const registry = createReportComponentRegistry([definition()]);
    for (const binding of [
      { toJSON: () => ({}) }, { run: () => 1 }, JSON.parse('{"__proto__":{"polluted":true}}'), { value: Infinity }, { value: Symbol("x") },
      Object.defineProperty({}, "value", { get: getter, enumerable: true }), new Date(), { value: "x".repeat(65_537) }, new Array(2),
    ]) expect(() => registry.createComponent("business.stamp", { binding: binding as never })).toThrow(ReportComponentExtensionError);
    expect(getter).not.toHaveBeenCalled();
    let depth: unknown = {}; for (let index = 0; index < 18; index++) depth = { value: depth };
    expect(() => registry.createComponent("business.stamp", { binding: depth as never })).toThrow(/budget/);
    expect(() => registry.createComponent("business.stamp", { binding: Array.from({ length: 2049 }, () => null) })).toThrow(/budget|arrays/);
    class ForeignArray extends Array<number> {}
    expect(() => registry.createComponent("business.stamp", { binding: new ForeignArray(1, 2) })).toThrow(/plain dense/);
    const changed: number[] = [1, 2]; Object.setPrototypeOf(changed, Object.create(Array.prototype));
    expect(() => registry.createComponent("business.stamp", { binding: changed })).toThrow(/plain dense/);
    const foreign = Object.assign(Object.create({ inherited: true }), definition()) as ReportComponentExtensionDefinition;
    expect(() => createReportComponentRegistry([foreign])).toThrow(/plain object/);
  });

  it("validates definitions and property constraints before any renderer loads", () => {
    const spec = definition();
    expect(() => createReportComponentRegistry([spec, spec])).toThrow(/already registered/);
    for (const patch of [
      { id: "" }, { version: "latest" }, { kind: "text" }, { label: "" }, { description: () => "x" },
      { properties: { x: { label: "x", type: "number", min: 2, max: 1 } } },
      { properties: { x: { label: "x", type: "string", min: 1 } } },
      { properties: { x: { label: "x", type: "string", maxLength: -1 } } },
      { properties: { x: { label: "x", type: "number", maxLength: 2 } } },
      { properties: { x: { label: "x", type: "unknown" } } },
      { properties: { x: { label: "x", type: "number", default: "wrong" } } },
      { properties: { x: { label: "x", type: "string", required: "true" } } },
      { properties: { x: { label: "x", type: "string", options: [] } } },
      { properties: { x: { label: "x", type: "string", options: [2] } } },
    ]) expect(() => createReportComponentRegistry([{ ...spec, ...patch } as never])).toThrow(ReportComponentExtensionError);
    const required = definition(); required.properties = { title: { label: "Title", type: "string", required: true } };
    expect(() => createReportComponentRegistry([required]).createComponent(required.id)).toThrow(/Required/);
    expect(() => createReportComponentRegistry(Array.from({ length: 129 }, (_, index) => definition(`id${index}`)))).toThrow(/128/);
    expect(() => createReportComponentRegistry([null as never])).toThrow(/object/);
  });
});
