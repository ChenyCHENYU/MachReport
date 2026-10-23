import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref, type PropType } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate, type ReportTemplateDocument } from "../../index";
import { useTemplateEditor, type TemplateEditorOptions } from "../useTemplateEditor";
import { useParamEditor } from "../useParamEditor";
import { useRuleEditor } from "../useRuleEditor";
import { useExcelBindingWizard } from "../useExcelBindingWizard";
import TemplateRecoveryPanel from "../TemplateRecoveryPanel.vue";
import { createTemplateDraftStorage, templateDraftKey, type TemplateDraftStorage } from "../draft-storage";
const fixtures = () => defineReportTemplate({ id: "daily", name: "日报", revision: "1", template: createTableTemplate({ columns: [{ header: "炉号", field: "heat" }], layout: "wide" }) });
const tick = async () => { await flushPromises(); await new Promise(resolve => setTimeout(resolve, 5)); await flushPromises(); };
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function memory(scope = "account:plant") {
  const values = new Map<string, string>();
  const adapter = createTemplateDraftStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } });
  return { values, storage: { scope, adapter, debounceMs: 0 } satisfies TemplateDraftStorage };
}
function harness(options: TemplateEditorOptions, tool?: "params" | "rules" | "excel") {
  let editor!: ReturnType<typeof useTemplateEditor>;
  let params!: ReturnType<typeof useParamEditor>, rules!: ReturnType<typeof useRuleEditor>, excel!: ReturnType<typeof useExcelBindingWizard>;
  const shown = ref(false);
  const Child = { setup() {
    if (tool === "params") params = useParamEditor({ get document() { return editor.draft.value; }, accept: () => true });
    if (tool === "rules") rules = useRuleEditor({ get list() { return editor.activeList.value!; }, datasets: { detail: [{ heat: "PRODUCTION-SECRET" }] } }, () => {});
    if (tool === "excel") excel = useExcelBindingWizard({ datasets: [] }, () => {});
    return () => null;
  } };
  const wrapper = mount(defineComponent({ props: { modelValue: { type: Object as PropType<ReportTemplateDocument>, required: true }, draftStorage: { type: Object as PropType<TemplateDraftStorage>, default: undefined }, save: { type: Function as PropType<TemplateEditorOptions["save"]>, default: undefined }, loadLatest: { type: Function as PropType<TemplateEditorOptions["loadLatest"]>, default: undefined }, keepCopy: { type: Function as PropType<TemplateEditorOptions["keepCopy"]>, default: undefined } }, emits: ["update:modelValue", "saved"], setup(props, { emit }) {
    editor = useTemplateEditor(props as TemplateEditorOptions, emit);
    return () => h("div", [h(TemplateRecoveryPanel, { recovery: editor.recovery, conflict: editor.conflict, canLoad: !!props.loadLatest, canCopy: !!props.keepCopy }), shown.value ? h(Child) : null]);
  } }), { props: options });
  cleanup.push(() => wrapper.unmount());
  return { wrapper, editor, show: async () => { shown.value = true; await tick(); }, get params() { return params; }, get rules() { return rules; }, get excel() { return excel; } };
}

describe("declaration-only draft recovery", () => {
  it("offers explicit recovery for template and invalid unapplied JSON without production rows", async () => {
    const { storage, values } = memory(); const first = harness({ modelValue: fixtures(), draftStorage: storage, datasets: { detail: [{ heat: "PRODUCTION-SECRET" }] } });
    await tick(); first.editor.setName("本地草稿"); first.editor.json.value = "{ invalid input"; await tick();
    const raw = values.get(templateDraftKey(storage.scope, "daily"))!;
    expect(raw).toContain("本地草稿"); expect(raw).not.toContain("PRODUCTION-SECRET"); first.wrapper.unmount();
    const next = harness({ modelValue: fixtures(), draftStorage: storage }); await tick();
    expect(next.editor.draft.value.name).toBe("日报"); expect(next.wrapper.text()).toContain("发现未保存草稿");
    await next.wrapper.findAll("button").find(button => button.text() === "恢复草稿")!.trigger("click");
    expect(next.editor.draft.value.name).toBe("本地草稿"); expect(next.editor.json.value).toBe("{ invalid input"); expect(next.editor.jsonPending.value).toBe(true);
  });
  it.each(["params", "rules", "excel"] as const)("restores lazy %s form declarations and blocks save until applied", async tool => {
    const { storage, values } = memory(); const first = harness({ modelValue: fixtures(), draftStorage: storage }, tool); await tick(); await first.show();
    if (tool === "params") { first.params.add(); first.params.current.value!.field = "pendingParameter"; }
    if (tool === "rules") first.rules.formula.value.field = "pendingCalculated";
    if (tool === "excel") { first.excel.recipe.value.sheet = "Sheet1"; first.excel.recipe.value.dataset = "pendingDataset"; }
    await tick(); const raw = values.get(templateDraftKey(storage.scope, "daily"))!; expect(raw).toBeTruthy(); expect(raw).not.toContain("PRODUCTION-SECRET"); first.wrapper.unmount();
    const next = harness({ modelValue: fixtures(), draftStorage: storage }, tool); await tick(); next.editor.recovery.restore(); expect(next.editor.toolPending.value).toBe(true); await next.show();
    if (tool === "params") expect(next.params.current.value!.field).toBe("pendingParameter");
    if (tool === "rules") expect(next.rules.formula.value.field).toBe("pendingCalculated");
    if (tool === "excel") { expect(next.excel.recipe.value.dataset).toBe("pendingDataset"); expect(next.excel.imported.value).toBeUndefined(); expect(next.excel.recoveredMapping.value).toBe(true); }
    expect(next.editor.pendingLocalChanges.value).toBe(true);
  });
  it("discovers an older baseline, requires explicit conflict resolution and CAS uses latest revision", async () => {
    const { storage } = memory(); const first = harness({ modelValue: fixtures(), draftStorage: storage }); await tick(); first.editor.setName("local"); await tick(); first.wrapper.unmount();
    const latest = { ...fixtures(), name: "remote", revision: "2" }; const save = vi.fn(async (doc: ReportTemplateDocument) => ({ ...doc, revision: "3" }));
    const next = harness({ modelValue: latest, draftStorage: storage, save }); await tick(); expect(next.editor.recovery.stale.value).toBe(true); next.editor.recovery.restore();
    expect(next.editor.conflict.active.value).toBe(true); expect(next.editor.blocked.value).toBe(true); await next.editor.save(); expect(save).not.toHaveBeenCalled();
    next.editor.conflict.rebase(); expect(next.editor.draft.value.revision).toBe("1");
    next.editor.conflict.confirmRebase.value = true; next.editor.conflict.rebase(); expect(next.editor.draft.value).toMatchObject({ name: "local", revision: "2" });
    await next.editor.save(); expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "local", revision: "2" }), expect.objectContaining({ expectedRevision: "2" }));
  });
  it("fences late reads across account scopes and reports storage/budget errors", async () => {
    let resolve!: (value: string | null) => void; const storage = { scope: "one", adapter: { read: () => new Promise<string | null>(done => { resolve = done; }), write: () => {}, remove: () => {} }, debounceMs: 0 };
    const app = harness({ modelValue: fixtures(), draftStorage: storage }); await flushPromises(); const old = resolve; const other = memory("two"); await app.wrapper.setProps({ draftStorage: other.storage }); old("not JSON"); await tick();
    expect(app.editor.recovery.available.value).toBeUndefined(); expect(app.editor.recovery.error.value).toBe("");
    await app.wrapper.setProps({ draftStorage: { ...other.storage, maxBytes: 1024 } }); await tick(); app.editor.setDescription("X".repeat(2000)); await tick(); expect(app.editor.recovery.error.value).toContain("budget"); expect(other.values.size).toBe(0);
  });
  it("preserves local content on CAS conflict; copy and latest-load callbacks receive cancellation", async () => {
    const loadLatest = vi.fn(async () => ({ ...fixtures(), name: "remote", revision: "2" })); const keepCopy = vi.fn(async () => {});
    const save = vi.fn(async () => { throw Object.assign(new Error("conflict"), { code: "conflict" }); });
    const app = harness({ modelValue: fixtures(), save, loadLatest, keepCopy }); app.editor.setName("local"); await app.editor.save(); await tick();
    expect(app.editor.draft.value.name).toBe("local"); expect(app.editor.conflict.latest.value?.revision).toBe("2"); expect(app.editor.conflict.localChanges.value.totalChanges).toBe(1); expect(app.editor.conflict.remoteChanges.value?.totalChanges).toBe(1);
    await app.editor.conflict.keepCopy(); expect(keepCopy).toHaveBeenCalledWith(expect.objectContaining({ name: "local" }), expect.objectContaining({ id: "daily", signal: expect.any(AbortSignal) }));
    expect(app.editor.conflict.active.value).toBe(true); expect(app.editor.conflict.copied.value).toBe(true);
  });
  it("flushes synchronous browser storage before pagehide, even inside the debounce window", async () => {
    const { storage, values } = memory(); storage.debounceMs = 10000;
    const app = harness({ modelValue: fixtures(), draftStorage: storage }); await tick(); app.editor.setName("last keystroke");
    globalThis.dispatchEvent(new Event("pagehide"));
    expect(values.get(templateDraftKey(storage.scope, "daily"))).toContain("last keystroke");
  });
  it("keeps corrupt form payloads out of mounted tools and allows discarding them", async () => {
    const { storage, values } = memory(); const first = harness({ modelValue: fixtures(), draftStorage: storage }, "params"); await tick(); await first.show(); first.params.add(); await tick(); first.wrapper.unmount();
    const key = templateDraftKey(storage.scope, "daily"), raw = JSON.parse(values.get(key)!); raw.tools.params.value = '{"rows":[null]}'; values.set(key, JSON.stringify(raw));
    const next = harness({ modelValue: fixtures(), draftStorage: storage }, "params"); await tick(); expect(next.editor.recovery.available.value).toBeUndefined(); expect(next.editor.recovery.error.value).toContain("Invalid stored params draft"); expect(next.editor.draft.value.name).toBe("日报");
    await next.editor.recovery.discard(); expect(values.has(key)).toBe(false);
  });

  it("serializes remounted editors behind older writes and coalesces pending storage work", async () => {
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; }), values = new Map<string, string>();
    const write = vi.fn(async (key: string, value: string) => { await gate; values.set(key, value); });
    const storage = { scope: "slow", debounceMs: 0, adapter: { read: (key: string) => values.get(key) ?? null, write, remove: (key: string) => { values.delete(key); } } };
    const first = harness({ modelValue: fixtures(), draftStorage: storage }); await tick(); first.editor.setName("old"); await tick();
    for (let index = 0; index < 10; index++) { first.editor.setName(`latest-${index}`); first.editor.recovery.flush(); }
    expect(write).toHaveBeenCalledTimes(1); first.wrapper.unmount();
    const next = harness({ modelValue: fixtures(), draftStorage: storage }); await tick(); expect(next.editor.blocked.value).toBe(true);
    release(); await tick(); expect(write).toHaveBeenCalledTimes(2); expect(next.editor.recovery.available.value?.document.name).toBe("latest-9");
    await next.editor.recovery.discard(); expect(values.size).toBe(0);
  });

  it("rebases an existing revision onto an unpublished baseline without an undefined JSON property", async () => {
    const latest = fixtures(); delete latest.revision;
    const loadLatest = vi.fn(async () => latest);
    const save = vi.fn(async () => { throw Object.assign(new Error("conflict"), { code: "conflict" }); });
    const app = harness({ modelValue: fixtures(), save, loadLatest });
    app.editor.setName("local"); await app.editor.save(); await tick();
    app.editor.conflict.confirmRebase.value = true; app.editor.conflict.rebase();
    expect(app.editor.conflict.active.value).toBe(false);
    expect(app.editor.validation.value.ok).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(app.editor.draft.value, "revision")).toBe(false);
    expect(app.editor.draft.value.name).toBe("local");
    expect(app.editor.originalDocument.value).toEqual(latest);
  });

});
