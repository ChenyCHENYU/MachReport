// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createReportSource, createTableTemplate } from "../../index";
import type { ReportDiagnostic } from "../../source/provider";
import { isReportDataTarget } from "../../source/data-explanation";
import ReportPreview from "../ReportPreview.vue";
import ReportDataExplanation from "../ReportDataExplanation.vue";
import { DEFAULT_MESSAGES } from "../config";
import { scopeQueryDiagnostics } from "../query-diagnostics";

let wrapper: VueWrapper | undefined;
afterEach(() => { wrapper?.unmount(); document.body.replaceChildren(); });
const rows = [{ id: "0001", weight: 0 }, { id: "0002", weight: null }];
function source(diagnostics: ReportDiagnostic[]) {
  const template = createTableTemplate({ listOptions: { rowKey: "id" }, columns: [{ field: "id", header: "产品" }, { field: "weight", header: "重量" }] });
  return createReportSource({ report: { template, provider: { query: () => ({ datasets: { detail: rows }, diagnostics }) } } });
}
const missing: ReportDiagnostic = { code: "source-weight", message: "该炉次没有重量实绩来源", severity: "info", valueState: "missing-source", target: { datasetId: "detail", rowKey: "0002", field: "weight" } };
describe("business-declared data explanations", () => {
  it("keeps the existing source data unchanged and rejects malformed value states", async () => {
    const result = await source([missing])({ reportIds: ["report"], params: {} });
    expect(result.pages.length).toBeGreaterThan(0); expect(rows[0]!.weight).toBe(0); expect(rows[1]!.weight).toBeNull();
    await expect(source([{ ...missing, valueState: "guess" as never }])({ reportIds: ["report"], params: {} })).rejects.toMatchObject({ code: "validate" });
    await expect(source([{ ...missing, target: undefined }])({ reportIds: ["report"], params: {} })).rejects.toMatchObject({ code: "validate" });
    expect(isReportDataTarget({ datasetId: "detail", rowKey: 0, field: "weight" })).toBe(true);
    expect(isReportDataTarget({ datasetId: "detail", rowKey: Infinity, field: "weight" })).toBe(false);
  });
  it("shows one compact optional summary, locates the actual business row and separates output diagnostics", async () => {
    wrapper = mount(ReportPreview, { props: { reportId: "report", fetcher: source([missing]), showExport: false, showPdfWindow: false }, attachTo: document.body });
    await vi.waitFor(() => expect(wrapper!.find(".mrp-data-explanation").exists()).toBe(true));
    expect(wrapper.find(".mrp-data-explanation").attributes("open")).toBeUndefined();
    expect(wrapper.find(".mrp-diagnostics").exists()).toBe(false);
    await wrapper.find(".mrp-data-explanation summary").trigger("click");
    await wrapper.find(".mrp-data-content button").trigger("click");
    await vi.waitFor(() => expect(wrapper!.find(".mrp-cell-focus").exists()).toBe(true));
    expect(wrapper.find(".mrp-cell-focus").text()).toBe("");
    await wrapper.setProps({ fetcher: source([]) });
    await vi.waitFor(() => expect(wrapper!.find(".mrp-data-explanation").exists()).toBe(false));
  });
  it("deduplicates by full business identity, searches explanations and bounds the mounted list", async () => {
    const entries = Array.from({ length: 150 }, (_, index) => ({ ...missing, target: { ...missing.target!, rowKey: String(index) } }));
    wrapper = mount(ReportDataExplanation, { props: { entries, messages: DEFAULT_MESSAGES } });
    expect(wrapper.findAll("li")).toHaveLength(100);
    await wrapper.find("input").setValue("149"); expect(wrapper.findAll("li")).toHaveLength(1);
    await wrapper.find("button").trigger("click"); expect(wrapper.emitted("locate")?.[0]?.[0]).toMatchObject({ rowKey: "149", field: "weight" });
    await wrapper.setProps({ busy: true }); expect(wrapper.find("button").attributes("disabled")).toBeDefined();
    await wrapper.find("input").setValue("业务不适用"); expect(wrapper.findAll("li")).toHaveLength(0);
  });
  it.each([false, true])("isolates matching business keys across reports, including repeated IDs (%s)", async repeated => {
    const template = createTableTemplate({ listOptions: { rowKey: "id" }, columns: [{ field: "id", header: "产品" }, { field: "weight", header: "重量" }] });
    let calls = 0;
    const provider = { query: () => ({
      datasets: { detail: [{ id: "0002", weight: calls++ ? null : 0 }] },
      diagnostics: calls === 2 ? [missing] : [],
    }) };
    const fetcher = createReportSource({ a: { template, provider }, b: { template, provider } });
    wrapper = mount(ReportPreview, { props: { reportId: repeated ? ["a", "a"] : ["a", "b"], fetcher, showExport: false, showPdfWindow: false }, attachTo: document.body });
    await vi.waitFor(() => expect(wrapper!.find(".mrp-data-content button").exists()).toBe(true));
    await wrapper.find(".mrp-data-content button").trigger("click");
    await vi.waitFor(() => expect(wrapper!.find(".mrp-cell-focus").exists()).toBe(true));
    expect(wrapper.find(".mrp-cell-focus").text()).toBe("");
    expect(wrapper.findAll(".mrp-page-holder").findIndex(holder => holder.find(".mrp-cell-focus").exists())).toBe(1);
  });
  it("scopes raw table identities and refuses ambiguous legacy callbacks", () => {
    const target = { ...missing.target!, tableId: "raw-table" };
    const [scoped] = scopeQueryDiagnostics(["a", "a"], "a", [{ ...missing, target }], 1);
    expect(scoped?.target).toMatchObject({ reportScope: '[1,"a"]', tableId: '[1,"a","raw-table"]' });
    expect(scopeQueryDiagnostics(["a", "a"], "a", [missing])[0]?.target?.reportScope).toBe('[-1,"a"]');
    expect(scopeQueryDiagnostics(["a", "a"], "a", [scoped!], 1)[0]?.target).toEqual(scoped!.target);
    expect(target.tableId).toBe("raw-table"); expect(missing.target).not.toHaveProperty("reportScope");
  });
});
