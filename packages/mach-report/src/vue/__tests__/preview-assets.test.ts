// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { AssetRenderOptions, RenderPlan } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";
import type { PlanFetcher } from "../adapters";
const mounted = new Set<VueWrapper>();
afterEach(() => { mounted.forEach((wrapper) => wrapper.unmount()); mounted.clear(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function source(text = "A"): RenderPlan { return { schemaVersion: "asset-test", pages: [{ pageWidthMm: 100, pageHeightMm: 100, components: [{ kind: "qrcode", leftMm: 10, topMm: 10, widthMm: 20, heightMm: 20, text }] }] }; }
function create(assets?: AssetRenderOptions) {
  const original = source();
  const fetcher: PlanFetcher = async ({ reportIds }) => reportIds[0] === "A" ? original : source("B");
  const wrapper = mount(ReportPreview, { props: { reportId: "A", assets, fetcher, showExport: false, showPdfWindow: false }, attachTo: document.body });
  mounted.add(wrapper); return { wrapper, original, report: wrapper.vm as unknown as MachReportController };
}
describe("shared preview assets", () => {
  it("prepares a renderer once and reuses its immutable image-backed plan for preview and consumers", async () => {
    const qrcode = vi.fn().mockResolvedValue(image);
    const { wrapper, original, report } = create({ assetRenderers: { qrcode } });
    await vi.waitFor(() => expect(wrapper.find("img").exists()).toBe(true));
    expect(qrcode).toHaveBeenCalledOnce();
    expect(wrapper.find("img").attributes("src")).toBe(image);
    expect(report.getPlan!()!.pages[0]!.components[0]!.imageData).toBe(image);
    expect(original.pages[0]!.components[0]!.imageData).toBeUndefined();
  });
  it("keeps existing fallback behavior when no adapter is configured", async () => {
    const { wrapper, report } = create();
    await vi.waitFor(() => expect(wrapper.find("[data-mr-unsupported='qrcode']").exists()).toBe(true));
    expect(report.state?.error).toBeNull();
    expect(report.getPlan!()!.pages[0]!.components[0]!.imageData).toBeUndefined();
  });
  it("classifies adapter failures as render errors and permits explicit placeholder diagnostics", async () => {
    const fail = vi.fn().mockRejectedValue(new Error("QR renderer unavailable"));
    const { wrapper, report } = create({ assetRenderers: { qrcode: fail } });
    await vi.waitFor(() => expect(report.state?.error?.code).toBe("render"));
    expect(wrapper.find("img").exists()).toBe(false);
    const onDiagnostic = vi.fn();
    const placeholder = create({ assetRenderers: { qrcode: fail }, assetFailure: "placeholder", onDiagnostic });
    await vi.waitFor(() => expect(placeholder.wrapper.find("[data-mr-unsupported='qrcode']").exists()).toBe(true));
    expect(onDiagnostic).toHaveBeenCalledOnce();
    expect(placeholder.wrapper.emitted("warning")).toHaveLength(1);
  });
  it("aborts superseded asset work and never installs its late result", async () => {
    let finish!: (value: string) => void;
    let signal!: AbortSignal;
    const qrcode = vi.fn(({ component, signal: current }: { component: { text?: string }; signal: AbortSignal }) => {
      if (component.text === "B") return image;
      signal = current; return new Promise<string>((resolve) => { finish = resolve; });
    });
    const { wrapper, report } = create({ assetRenderers: { qrcode } });
    await vi.waitFor(() => expect(qrcode).toHaveBeenCalledOnce());
    await wrapper.setProps({ reportId: "B" });
    await vi.waitFor(() => expect(wrapper.find("img").exists()).toBe(true));
    expect(signal.aborted).toBe(true);
    finish(image);
    await flushPromises();
    expect(report.getPlan!()!.pages[0]!.components[0]!.text).toBe("B");
    expect(wrapper.emitted("loaded")).toHaveLength(1);
    expect(wrapper.emitted("error")).toBeUndefined();
  });
});
