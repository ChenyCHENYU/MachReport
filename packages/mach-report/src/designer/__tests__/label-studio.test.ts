import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive } from "vue";
import { serializeReportTemplate, type DatasetContract, type ReportTemplateDocument } from "@agile-team/mach-report";
import { useLabelStudio, type LabelStudioOptions } from "../useLabelStudio";
import { createLabelStudioDocument } from "../label-studio-template";

const schema: DatasetContract = { rowKey: "id", fields: [{ field: "id", type: "text" }, { field: "heat", label: "炉号", type: "text", semanticRole: "identifier" }, { field: "weight", label: "重量", type: "number", format: { kind: "number", digits: 3 }, nullable: true }] };
const rows = [{ id: "1", heat: "00123", weight: 0 }, { id: "2", heat: "00456", weight: null }];
const dispose: Array<() => void> = [];
afterEach(() => { dispose.splice(0).forEach(fn => fn()); document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture(options: Partial<LabelStudioOptions> = {}) {
  const props = reactive<LabelStudioOptions>({ rows, schema, title: "测试标签", ...options });
  const updates: ReportTemplateDocument[] = [];
  let studio!: ReturnType<typeof useLabelStudio>;
  const target = document.createElement("div"); document.body.append(target);
  const app = createApp(defineComponent({ setup() { studio = useLabelStudio(props, value => updates.push(value)); return () => h("div"); } }));
  app.mount(target); dispose.push(() => app.unmount());
  return { props, studio, updates, app };
}
it("builds editable two-face labels from declared identity and format without inventing or changing values", async () => {
  const f = fixture(); expect(f.updates).toHaveLength(1); expect(f.studio.labelCount.value).toBe(4);
  const template = f.studio.document.value.template;
  expect(template.repeat).toMatchObject({ dataset: "records", rowKey: "id" });
  expect(template.pages[0]!.components.find(c => c.kind !== "list" && c.binding?.field === "weight")).toMatchObject({ binding: { format: { kind: "number", digits: 3 } } });
  const plan = await f.studio.fetcher.value({ reportIds: ["labels"], params: {} });
  expect(plan.pages).toHaveLength(4);
  expect(plan.pages[0]!.components.some(c => c.text === "00123")).toBe(true);
  expect(plan.pages[0]!.components.some(c => c.text === "0.000")).toBe(true);
  expect(JSON.stringify(rows)).toBe('[{"id":"1","heat":"00123","weight":0},{"id":"2","heat":"00456","weight":null}]');
});
it("selects any record by index with constant-size UI state and resets selection for new data", async () => {
  const f = fixture(); f.studio.record.value = "single"; f.studio.recordIndex.value = 2;
  expect(f.studio.rows.value).toEqual([rows[1]]); expect(f.studio.labelCount.value).toBe(2);
  f.studio.recordIndex.value = 500; expect(f.studio.rows.value).toEqual([]);
  f.props.rows = [rows[0]!]; await nextTick(); expect(f.studio.record.value).toBe("all");
  expect(f.studio.rows.value).toEqual([rows[0]]);
  f.studio.sheet.value = true;
  const plan = await f.studio.fetcher.value({ reportIds: ["labels"], params: {} });
  expect(plan.pages).toHaveLength(1); expect(plan.pages[0]!.pageWidthMm).toBe(210);
});
it("valid edits prepare before preview; failed or unapplied edits keep the user in the editor", async () => {
  const f = fixture(); await f.studio.navigate("design"); let pending = true, allowed = true;
  f.studio.editor.value = { get pendingLocalChanges() { return pending; }, get canApply() { return allowed; }, insertComponent: () => false, reset: async () => {}, save: vi.fn(async () => { pending = false; }), guardChanges: async () => true };
  allowed = false; await f.studio.navigate("preview"); expect(f.studio.mode.value).toBe("design"); expect(f.studio.notice.value).toContain("应用当前配置");
  allowed = true; await f.studio.navigate("preview"); expect(f.studio.editor.value.save).toHaveBeenCalledOnce(); expect(f.studio.mode.value).toBe("preview");
});
it("discard uses the saved label document and cancellation preserves local changes", async () => {
  const f = fixture(); const original = serializeReportTemplate(f.studio.document.value); let allowed = false;
  const changed = structuredClone(f.studio.document.value); changed.name = "未保存"; f.studio.update(changed);
  f.studio.editor.value = { pendingLocalChanges: true, insertComponent: () => false, save: async () => {}, reset: async () => {}, guardChanges: async () => allowed };
  expect(await f.studio.guardChanges()).toBe(false); expect(f.studio.document.value.name).toBe("未保存");
  allowed = true; expect(await f.studio.guardChanges()).toBe(true); expect(serializeReportTemplate(f.studio.document.value)).toBe(original);
});
it("honors explicit copy counts and controlled documents; aborted saves cannot emit late state", async () => {
  const document = createLabelStudioDocument(schema, "份数"); document.template.repeat!.copies = { field: "weight" };
  const f = fixture({ modelValue: document }); expect(f.updates).toHaveLength(0); expect(f.studio.labelCount.value).toBeUndefined();
  f.props.modelValue = createLabelStudioDocument(schema, "新的模板"); await nextTick(); expect(f.studio.document.value.name).toBe("新的模板");
  const controller = new AbortController(); controller.abort();
  await expect(f.studio.save(f.studio.document.value, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(f.updates).toHaveLength(0);
});
