import { createApp, defineComponent, h, reactive } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { useLabelStudio, type LabelStudioOptions } from "../useLabelStudio";
import { createLabelStudioDocument } from "../label-studio-template";
import { rebuildLabelStudioDocument } from "../label-studio-content";
import type { MachReportController } from "@agile-team/mach-report/vue";
import type { ReportTemplateDataContract } from "@agile-team/mach-report";

const schema = { rowKey: "id", fields: [{ field: "id", type: "text" as const }, { field: "heat", type: "text" as const, semanticRole: "identifier" as const }] };
const dataContract: ReportTemplateDataContract = { source: "production", datasets: { records: { fields: [{ field: "id", semanticKey: "id", type: "text" }, { field: "heat", semanticKey: "heat_no", type: "text" }] } } };
const dispose: Array<() => void> = [];
afterEach(() => { dispose.splice(0).forEach(stop => stop()); document.body.replaceChildren(); });
function fixture(options: LabelStudioOptions) {
  const props = reactive(options);
  let studio!: ReturnType<typeof useLabelStudio>;
  const app = createApp(defineComponent({ setup() { studio = useLabelStudio(props, () => {}); return () => h("div"); } }));
  const target = document.createElement("div"); document.body.append(target); app.mount(target); dispose.push(() => app.unmount());
  return { studio, props };
}

it("delegates the label primary print action to the mounted preview and disables it without a printable plan", async () => {
  const { studio } = fixture({ schema, rows: [{ id: "1", heat: "26W001" }], preset: "material", dataContract });
  expect(studio.canPrint.value).toBe(false);
  await studio.print();
  const print = vi.fn(async () => {});
  const control: MachReportController = { state: { loading: false, hasPlan: true, pageCount: 1, currentPage: 1, exporting: null, printing: false, canPrint: true, canExport: true, error: null, pdfFont: { status: "unchecked", fontUrl: "" } }, print, reload: async () => {}, exportAs: () => {}, openPdfWindow: () => {}, gotoPage: () => {}, setParams: () => {} };
  studio.preview.ref(control);
  expect(studio.canPrint.value).toBe(true);
  expect(await studio.showPreview()).toBe(true);
  await studio.print(); expect(print).toHaveBeenCalledOnce();
  studio.mode.value = "design";
  expect(studio.canPrint.value).toBe(false);
  await studio.print(); expect(print).toHaveBeenCalledOnce();
  studio.preview.ref(null); expect(studio.canPrint.value).toBe(false);
});

it("retains declared data provenance when generated labels are rebuilt into another finished layout", () => {
  const initial = createLabelStudioDocument(schema, "生产标签", "heat", { preset: "material" }, dataContract);
  expect(initial.template.dataContract).toEqual(dataContract);
  const rebuilt = rebuildLabelStudioDocument(initial, schema, "生产标签", "heat", { preset: "paired" });
  expect(rebuilt.template.pages).toHaveLength(2);
  expect(rebuilt.template.dataContract).toEqual(dataContract);
});

it("validates the displayed label provenance again when the current business contract changes", async () => {
  const { props, studio } = fixture({ schema, rows: [{ id: "1", heat: "26W001" }], preset: "material", dataContract });
  const before = await studio.fetcher.value({ reportIds: ["labels"], params: {} });
  expect(before.pages).toHaveLength(1);
  props.dataContract = { ...dataContract, source: "different-report" };
  await expect(studio.fetcher.value({ reportIds: ["labels"], params: {} })).rejects.toThrow(/来源.*不一致/);
});
