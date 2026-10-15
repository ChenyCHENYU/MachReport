import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import ExcelJS from "exceljs";
import type { RenderPlan } from "@agile-team/mach-report";
import type { MachReportHandle } from "../controller";
import ReportPreview from "../ReportPreview.vue";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); vi.restoreAllMocks(); });

function sourcePlan(text: string): RenderPlan {
  return { schemaVersion: "import-test", pages: [{
    pageWidthMm: 210, pageHeightMm: 297,
    components: [{ kind: "text", text, leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10 }]
  }] };
}

async function excelBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("业务模板");
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = "生产日报";
  sheet.getCell("A2").value = "00123";
  sheet.getCell("B2").value = 0;
  sheet.getCell("B2").numFmt = "0.00";
  return new Uint8Array(await workbook.xlsx.writeBuffer() as unknown as ArrayBuffer);
}

function createPreview(props: Record<string, unknown> = {}) {
  const wrapper = mount(ReportPreview, {
    props: { autoLoad: false, showExport: false, showPdfWindow: false, ...props }, attachTo: document.body
  });
  wrappers.push(wrapper);
  return { wrapper, report: wrapper.vm as unknown as MachReportHandle };
}

describe("Excel import preview lifecycle", () => {
  it("explicit controller import works without a fetcher and keeps snapshots isolated", async () => {
    const { wrapper, report } = createPreview();
    expect(wrapper.find(".mrp-import-excel").exists()).toBe(false);
    const result = await report.importExcel(await excelBytes());
    expect(result?.sheets[0]?.name).toBe("业务模板");
    await vi.waitFor(() => expect(wrapper.text()).toContain("生产日报"));
    expect(report.state.importing).toBe(false);
    expect(report.state.dirty).toBe(false);
    expect(wrapper.emitted("template-import")).toHaveLength(1);
    const importedComponent = result!.template.pages[0]!.components[0]!;
    if ("grid" in importedComponent) importedComponent.grid!.cells[0]![0]!.text = "模板管理草稿";
    expect(report.getPlan()!.pages[0]!.components[0]!.grid!.cells[0]![0]!.text).toBe("生产日报");
    const snapshot = report.getPlan()!;
    snapshot.pages[0]!.components[0]!.grid!.cells[0]![0]!.text = "外部修改";
    expect(report.getPlan()!.pages[0]!.components[0]!.grid!.cells[0]![0]!.text).toBe("生产日报");
    expect(wrapper.text()).not.toContain("外部修改");
    await wrapper.setProps({ excelImport: true });
    expect(wrapper.find(".mrp-import-excel").exists()).toBe(true);
  });

  it("invalid workbook reports a structured import error and preserves the previous report", async () => {
    const { wrapper, report } = createPreview({ reportId: "source", fetcher: async () => sourcePlan("原报表") });
    await report.reload();
    const before = report.getPlan();
    await expect(report.importExcel(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: "import" });
    expect(report.getPlan()).toEqual(before);
    expect(report.state.importing).toBe(false);
    expect(wrapper.emitted("template-import")).toBeUndefined();
    expect(wrapper.emitted("error")?.at(-1)?.[1]).toMatchObject({ code: "import" });
  });

  it("reload discards a delayed old import, including its loaded/import events", async () => {
    const bytes = await excelBytes();
    const blob = new Blob([bytes.buffer]);
    let finish!: (value: ArrayBuffer) => void;
    const read = vi.spyOn(blob, "arrayBuffer").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { wrapper, report } = createPreview({ reportId: "source", fetcher: async () => sourcePlan("新查询结果") });
    const pending = report.importExcel(blob);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await report.reload();
    finish(bytes.buffer);
    expect(await pending).toBeNull();
    await vi.waitFor(() => expect(wrapper.text()).toContain("新查询结果"));
    expect(wrapper.text()).not.toContain("生产日报");
    expect(wrapper.emitted("template-import")).toBeUndefined();
    expect(wrapper.emitted("loaded")).toHaveLength(1);
  });
});
