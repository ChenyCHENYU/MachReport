import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { usePreviewDiagnostics } from "../composables/usePreviewDiagnostics";
import ReportDataExplanation from "../ReportDataExplanation.vue";
import ReportDiagnostics from "../ReportDiagnostics.vue";
import { DEFAULT_MESSAGES } from "../config";
import type { ReportPreviewDiagnostic } from "../guards";

const item = (index: number): ReportPreviewDiagnostic => ({ code: "missing-image", message: `Image ${index}`, severity: "warning", format: "xlsx", pageIndex: index, componentIndex: 0 });
const group = (total: number, entries = [item(1), item(2)]) => ({ total, counts: { "missing-image": total }, entries, omitted: total - entries.length });

describe("bounded preview diagnostic state", () => {
  it("coalesces 10000 incremental emissions into a bounded immutable window", async () => {
    let calls = 0;
    const diagnostics = usePreviewDiagnostics(() => { calls++; });
    const original = diagnostics.entries.value;
    for (let index = 0; index < 10000; index++) diagnostics.add(item(index));
    expect(diagnostics.entries.value).toBe(original);
    await Promise.resolve();
    expect(calls).toBe(10000);
    expect(diagnostics.entries.value).toHaveLength(200);
    expect(diagnostics.summary.value).toMatchObject({ total: 10000, omitted: 9800, counts: { "missing-image": 10000 } });
    expect(Object.isFrozen(diagnostics.summary.value.counts)).toBe(true);
    expect(Object.isFrozen(diagnostics.entries.value[0])).toBe(true);
  });
  it("preserves complete query diagnostic observer delivery while bounding retained data", () => {
    let calls = 0;
    const diagnostics = usePreviewDiagnostics(() => { calls++; });
    diagnostics.addMany(Array.from({ length: 500 }, (_, index) => item(index)));
    expect(calls).toBe(500);
    expect(diagnostics.summary.value).toMatchObject({ total: 500, omitted: 300 });
  });
  it("replaces repeated output summaries and restores all groups after a failed refresh", () => {
    const diagnostics = usePreviewDiagnostics(vi.fn());
    diagnostics.addMany([{ code: "query", message: "source warning", severity: "warning" }]);
    diagnostics.addSummary(group(164000), "xlsx");
    diagnostics.addSummary(group(164000), "xlsx");
    diagnostics.addSummary({ total: 1, counts: { "unsupported-text": 1 }, omitted: 0, entries: [{ ...item(9), code: "unsupported-text", format: "pdf" }] }, "pdf");
    expect(diagnostics.summary.value.total).toBe(164002);
    const captured = diagnostics.capture();
    diagnostics.reset(); diagnostics.addMany([{ code: "new-query", severity: "info", message: "candidate" }]);
    diagnostics.restore(captured);
    expect(diagnostics.summary.value.total).toBe(164002);
    expect(diagnostics.summary.value.counts).toEqual({ query: 1, "missing-image": 164000, "unsupported-text": 1 });
    diagnostics.addSummary(group(2), "xlsx");
    expect(diagnostics.summary.value.total).toBe(4);
  });
  it("keeps business explanation counts separate even when their details are omitted", () => {
    const diagnostics = usePreviewDiagnostics(vi.fn());
    const business = { code: "quantity", message: "not supplied", severity: "info" as const, valueState: "missing-source" as const, target: { datasetId: "detail", field: "quantity" } };
    diagnostics.addMany(Array.from({ length: 400 }, (_, index) => ({ ...business, message: `missing ${index}` })));
    diagnostics.add(item(1));
    const captured = diagnostics.capture();
    diagnostics.restore(captured, true);
    expect(diagnostics.summary.value.total).toBe(401);
    expect(diagnostics.summary.value.explanations?.total).toBe(400);
    expect(diagnostics.outputSummary.value).toMatchObject({ total: 1, omitted: 0, counts: { "missing-image": 1 } });
    expect(diagnostics.outputSummary.value.entries[0]!.code).toBe("missing-image");
    diagnostics.addSummary({ total: 0, counts: {}, entries: [], omitted: 0 }, "dom");
    expect(diagnostics.summary.value.total).toBe(401);
  });
  it("notifies restored candidate samples only on explicit acceptance and stops on reentrant reset", () => {
    const source = usePreviewDiagnostics(vi.fn()); source.addMany([item(1), item(2)]);
    const observer = vi.fn(); const restored = usePreviewDiagnostics(observer);
    restored.restore(source.capture()); expect(observer).not.toHaveBeenCalled();
    restored.restore(source.capture(), true); expect(observer).toHaveBeenCalledTimes(2);
    const reentrant = usePreviewDiagnostics(() => reentrant.reset());
    reentrant.restore(source.capture(), true);
    expect(reentrant.entries.value).toEqual([]);
  });
  it("does not resurrect deferred emissions after observers reset the report", async () => {
    const diagnostics = usePreviewDiagnostics(() => diagnostics.reset());
    diagnostics.add(item(1));
    await Promise.resolve();
    expect(diagnostics.summary.value.total).toBe(0);
    expect(diagnostics.entries.value).toEqual([]);
  });
});

describe("bounded diagnostic presentation", () => {
  it("shows the complete business explanation count separately from its bounded sample window", async () => {
    const entries = Array.from({ length: 150 }, (_, index) => ({ code: "quantity", message: `Missing ${index}`, severity: "info" as const, valueState: "missing-source" as const, target: { datasetId: "detail", field: "qty", rowKey: index } }));
    const wrapper = mount(ReportDataExplanation, { props: { entries, total: 400, messages: DEFAULT_MESSAGES } });
    expect(wrapper.find("summary b").text()).toBe("400");
    expect(wrapper.find(".mrp-data-omitted").text()).toContain("250");
    expect(wrapper.findAll("li")).toHaveLength(100);
    await wrapper.find(".mrp-data-more").trigger("click");
    expect(wrapper.findAll("li")).toHaveLength(150);
    await wrapper.find('input[type="search"]').setValue("Missing 149");
    expect(wrapper.findAll("li")).toHaveLength(1);
    await wrapper.find("li button").trigger("click");
    expect(wrapper.emitted("locate")?.[0]?.[0]).toEqual(entries[149]!.target);
    wrapper.unmount();
  });
  it("shows exact totals, omitted locations, category filters and incrementally revealed samples", async () => {
    const entries = Array.from({ length: 150 }, (_, index) => item(index));
    entries[149] = { ...item(149), code: "unsupported-style" };
    const summary = { total: 164000, entries, omitted: 163850, counts: { "missing-image": 163999, "unsupported-style": 1 } };
    const wrapper = mount(ReportDiagnostics, { props: { entries, summary, messages: DEFAULT_MESSAGES } });
    expect(wrapper.find("summary").text()).toContain("164000");
    expect(wrapper.find(".mrp-diagnostic-omitted").text()).toContain("163850");
    expect(wrapper.findAll("li")).toHaveLength(100);
    await wrapper.find(".mrp-diagnostic-more").trigger("click");
    expect(wrapper.findAll("li")).toHaveLength(150);
    const filter = wrapper.findAll(".mrp-diagnostic-groups button")[1]!;
    await filter.trigger("click");
    expect(wrapper.findAll("li")).toHaveLength(1);
    await wrapper.find("li button").trigger("click");
    expect(wrapper.emitted("locate")?.[0]?.[0]).toEqual(entries[149]);
    await filter.trigger("click");
    expect(wrapper.findAll("li")).toHaveLength(100);
    wrapper.unmount();
  });
});
