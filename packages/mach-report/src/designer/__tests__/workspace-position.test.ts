import { flushPromises, mount } from "@vue/test-utils";
import { h, reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate, type ReportTemplateDocument } from "../../index";
import { createTemplateDraftStorage, templateDraftKey, type TemplateDraftStorage } from "../draft-storage";
import { useTemplateEditor } from "../useTemplateEditor";
import { useTemplateInspector } from "../useTemplateInspector";
import { useTemplateWorkspace } from "../useTemplateWorkspace";
import { componentViewKey, documentViewKey, pageViewKey, parseWorkspaceView, resolveWorkspaceView, type DesignerWorkspaceView } from "../workspace-view";
import { useTemplateWorkspaceStorage } from "../useTemplateWorkspaceStorage";
import { useCanvasViewport } from "../useCanvasViewport";

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(close => close()); });
function document() {
  const template = createTableTemplate({ columns: [{ field: "heat", header: "炉号" }, { field: "energy", header: "用电" }] });
  const table = template.pages[0]!;
  for (let index = 0; index < 7; index++) template.pages.unshift({ widthMm: 210, heightMm: 297, components: [{ kind: "text", nid: `page-${index}`, text: `Business title ${index}`, leftMm: 5, topMm: 5, widthMm: 50, heightMm: 10 }] });
  const list = table.components[0]!;
  if (list.kind === "list") list.id = "eighth-table";
  return defineReportTemplate({ id: "daily", name: "日报", revision: "1", template });
}
function memory() {
  const values = new Map<string, string>();
  const adapter = createTemplateDraftStorage({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } });
  const storage: TemplateDraftStorage = { scope: "project:account", adapter, rememberView: true, debounceMs: 1000 };
  return { values, storage };
}
function mounted(modelValue: ReportTemplateDocument, draftStorage?: TemplateDraftStorage, withViewport = false) {
  const options = reactive({ modelValue, draftStorage, datasets: { detail: [{ heat: "SECRET-PRODUCTION-VALUE" }] } });
  let editor!: ReturnType<typeof useTemplateEditor>, inspector!: ReturnType<typeof useTemplateInspector>, workspace!: ReturnType<typeof useTemplateWorkspace>;
  let viewport!: ReturnType<typeof useCanvasViewport>;
  const Canvas = { setup() {
    viewport = useCanvasViewport({ get document() { return editor.draft.value; }, get pageIndex() { return workspace.canvasPage.value; }, get selection() { return workspace.canvasSelection.value; } });
    return () => h("div", { ref: viewport.viewport });
  } };
  const wrapper = mount({ setup() {
    editor = useTemplateEditor(options, () => {});
    inspector = useTemplateInspector(editor.selected, editor.activeList);
    workspace = useTemplateWorkspace(editor, inspector, () => undefined, { storage: () => options.draftStorage });
    return () => withViewport ? h(Canvas) : null;
  } });
  cleanup.push(() => wrapper.unmount());
  return { wrapper, options, get editor() { return editor; }, get inspector() { return inspector; }, get workspace() { return workspace; }, get viewport() { return viewport; } };
}
function position(value = document()): DesignerWorkspaceView {
  const page = value.template.pages[7]!;
  return { version: 1, templateId: value.id, documentKey: documentViewKey(value), page: { index: 7, key: pageViewKey(page) }, componentKey: componentViewKey(page.components[0]!), field: "energy", section: "fields", tool: "rules", mode: "design", viewport: { zoom: 1.2, left: 40, top: 200 } };
}
describe("optional bounded workspace recovery", () => {
  it("persists a clean editor's eighth-page field without dirtying or saving report content", async () => {
    const { values, storage } = memory();
    const first = mounted(document(), storage); await flushPromises();
    first.workspace.mode.value = "design";
    first.workspace.chooseCanvas({ pageIndex: 7, componentIndex: 0 });
    first.inspector.activate(1);
    await flushPromises(); first.workspace.position.flush(); await flushPromises();
    const raw = values.get(`${templateDraftKey(storage.scope, "daily")}:view`)!;
    expect(parseWorkspaceView(raw, "daily")).toMatchObject({ page: { index: 7 }, field: "energy", section: "fields", mode: "design" });
    expect(raw).not.toContain("SECRET-PRODUCTION-VALUE"); expect(raw).not.toContain("Business title"); expect(raw).not.toContain('"template"');
    expect(first.editor.pendingLocalChanges.value).toBe(false); expect(first.editor.canUndo.value).toBe(false);
    expect(values.has(templateDraftKey(storage.scope, "daily"))).toBe(false);
    first.wrapper.unmount();
    const next = mounted(document(), storage); await flushPromises();
    expect(next.workspace.canvasPage.value).toBe(0);
    expect(next.workspace.position.available.value).toBeDefined();
    await next.workspace.position.resume(); await flushPromises();
    expect(next.workspace.canvasPage.value).toBe(7); expect(next.inspector.activeIndex.value).toBe(1);
    expect(next.workspace.canvasSelection.value).toMatchObject({ pageIndex: 7, componentIndex: 0 });
    expect(next.editor.pendingLocalChanges.value).toBe(false); expect(next.editor.canUndo.value).toBe(false);
  });
  it("remembers fields selected in preview mode before the canvas is visited", async () => {
    const { values, storage } = memory(), app = mounted(document(), storage); await flushPromises();
    app.inspector.activate(1); app.workspace.position.flush(); await flushPromises();
    expect(parseWorkspaceView(values.get(`${templateDraftKey(storage.scope, "daily")}:view`)!, "daily")).toMatchObject({ page: { index: 7 }, field: "energy", mode: "preview" });
  });
  it("restores the existing canvas zoom and scroll after selection reveal has settled", async () => {
    const { storage } = memory();
    const first = mounted(document(), storage, true); await flushPromises();
    first.workspace.mode.value = "design"; first.workspace.chooseCanvas({ pageIndex: 7, componentIndex: 0 }); await flushPromises();
    first.viewport.setZoom(1.2); await flushPromises();
    first.viewport.viewport.value!.scrollLeft = 140; first.viewport.viewport.value!.scrollTop = 280; first.viewport.sync();
    first.workspace.position.flush(); await flushPromises(); first.wrapper.unmount();
    const next = mounted(document(), storage, true); await flushPromises();
    await next.workspace.position.resume(); await flushPromises();
    expect(next.viewport.zoom.value).toBe(1.2);
    expect(next.viewport.viewport.value!.scrollLeft).toBe(140); expect(next.viewport.viewport.value!.scrollTop).toBe(280);
    expect(next.editor.canUndo.value).toBe(false); expect(next.editor.dirty.value).toBe(false);
  });
  it("does not read or write view positions unless explicitly enabled", async () => {
    const { values, storage } = memory(); storage.rememberView = false;
    const app = mounted(document(), storage); await flushPromises();
    app.workspace.canvasPage.value = 2; app.workspace.position.flush(); await flushPromises();
    expect([...values.keys()].some(key => key.endsWith(":view"))).toBe(false);
  });
  it("resolves stable component identity after page insertion and safely crops deleted selections", () => {
    const value = document(), view = position(value);
    value.template.pages.unshift({ widthMm: 100, heightMm: 100, components: [] });
    expect(resolveWorkspaceView(value, view)).toMatchObject({ pageIndex: 8, componentIndex: 0, fieldIndex: 1, adjusted: true });
    value.template.pages[8]!.components = [];
    expect(resolveWorkspaceView(value, view)).toMatchObject({ pageIndex: 0, componentIndex: undefined, adjusted: true });
  });
  it("rejects invalid coordinates and over-budget records and drops unrecognized payload", () => {
    const view = position();
    expect(() => parseWorkspaceView(JSON.stringify({ ...view, viewport: { zoom: Infinity, left: -1, top: 0 } }), "daily")).toThrow("viewport");
    expect(() => parseWorkspaceView(JSON.stringify({ ...view, templateId: "other" }), "daily")).toThrow("identity");
    expect(() => parseWorkspaceView(JSON.stringify({ ...view, field: "x".repeat(9000) }), "daily")).toThrow("8 KiB");
    expect(parseWorkspaceView(JSON.stringify({ ...view, datasets: { secret: [1] } }), "daily")).not.toHaveProperty("datasets");
  });
  it("isolates accounts and fences late reads without affecting the active workspace", async () => {
    let finish!: (value: string | null) => void;
    const signals: AbortSignal[] = [];
    const { storage } = memory();
    const delayed: TemplateDraftStorage = { ...storage, adapter: { ...storage.adapter, read: (_key, { signal }) => { signals.push(signal); return new Promise(resolve => { finish = resolve; }); } } };
    const options = reactive({ storage: delayed, id: "daily" });
    let recovery!: ReturnType<typeof useTemplateWorkspaceStorage>;
    const restore = vi.fn(async () => false);
    const wrapper = mount({ setup() { recovery = useTemplateWorkspaceStorage({ storage: () => options.storage, id: () => options.id, changed: () => [], read: () => position(), restore }); return () => null; } });
    cleanup.push(() => wrapper.unmount()); await flushPromises();
    const oldFinish = finish;
    options.storage = { ...storage, scope: "another-account" }; await flushPromises();
    expect(signals[0]?.aborted).toBe(true);
    oldFinish(JSON.stringify(position())); await flushPromises();
    expect(recovery.available.value).toBeUndefined(); expect(restore).not.toHaveBeenCalled();
  });
  it("coalesces a slow final write and waits before reading it in a remounted editor", async () => {
    const { storage, values } = memory();
    let finish!: () => void;
    const writes: string[] = [];
    const adapter = { ...storage.adapter, write: async (key: string, value: string) => {
      writes.push(value);
      if (writes.length === 1) await new Promise<void>(resolve => { finish = resolve; });
      values.set(key, value);
    } };
    const slow = { ...storage, adapter };
    const first = mounted(document(), slow); await flushPromises();
    first.inspector.activate(1); first.workspace.position.flush(); await flushPromises();
    first.inspector.activate(0); first.workspace.position.flush(); first.wrapper.unmount();
    const next = mounted(document(), slow); await flushPromises();
    expect(next.workspace.position.available.value).toBeUndefined();
    finish(); await flushPromises();
    expect(writes).toHaveLength(2);
    expect(next.workspace.position.available.value?.field).toBe("heat");
    await next.workspace.position.resume();
    expect(next.inspector.activeIndex.value).toBe(0);
  });
  it("reports malformed positions and cancels in-flight reads on unmount", async () => {
    const { storage, values } = memory();
    values.set(`${templateDraftKey(storage.scope, "daily")}:view`, "invalid");
    const app = mounted(document(), storage); await flushPromises();
    expect(app.workspace.position.error.value).toBeTruthy(); expect(app.editor.blocked.value).toBe(false);
    let signal!: AbortSignal;
    const pendingStorage: TemplateDraftStorage = { ...storage, adapter: { ...storage.adapter, read: (_key, context) => { signal = context.signal; return new Promise(() => {}); } } };
    let state!: ReturnType<typeof useTemplateWorkspaceStorage>;
    const wrapper = mount({ setup() { state = useTemplateWorkspaceStorage({ storage: () => pendingStorage, id: () => "daily", changed: () => [], read: () => position(), restore: async () => false }); return () => null; } });
    await flushPromises(); wrapper.unmount(); expect(signal.aborted).toBe(true); expect(state.available.value).toBeUndefined();
  });
});
