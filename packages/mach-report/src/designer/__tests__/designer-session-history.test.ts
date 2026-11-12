import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, nextTick, type PropType } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate, type ReportTemplateDocument } from "../../index";
import { useTemplateEditor, type TemplateEditorOptions } from "../useTemplateEditor";
import { useDesignerShortcuts } from "../useDesignerShortcuts";

const document = () => defineReportTemplate({
  id: "session", name: "Original", revision: "1",
  template: createTableTemplate({ columns: [{ field: "heat", header: "Heat" }] }),
});
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(close => close()); vi.useRealTimers(); });
function harness(save?: TemplateEditorOptions["save"]) {
  let editor!: ReturnType<typeof useTemplateEditor>;
  const wrapper = mount(defineComponent({
    props: { modelValue: { type: Object as PropType<ReportTemplateDocument>, required: true } },
    emits: ["update:modelValue", "saved"],
    setup(props, { emit }) { editor = useTemplateEditor({ ...props, save }, emit); return () => null; },
  }), { props: { modelValue: document() } });
  cleanup.push(() => wrapper.unmount());
  return { wrapper, get editor() { return editor; } };
}

describe("continuous template editing sessions", () => {
  it("retains undo/redo after saving and subsequent saves use the latest CAS revision", async () => {
    let revision = 1;
    const save = vi.fn(async (value: ReportTemplateDocument) => ({ ...value, revision: String(++revision) }));
    const { editor } = harness(save);
    editor.setName("Changed");
    await editor.save();
    expect(editor.canUndo.value).toBe(true);
    editor.undo();
    expect(editor.draft.value).toMatchObject({ name: "Original", revision: "2" });
    expect(editor.pendingLocalChanges.value).toBe(true);
    editor.redo();
    expect(editor.draft.value).toMatchObject({ name: "Changed", revision: "2" });
    expect(editor.pendingLocalChanges.value).toBe(false);
    editor.undo();
    await editor.save();
    expect(save.mock.calls[1]?.[0]).toMatchObject({ name: "Original", revision: "2" });
    expect(editor.draft.value.revision).toBe("3");
  });

  it("coalesces consecutive text edits while keeping different controls and new branches distinct", () => {
    const { editor } = harness();
    editor.setName("A"); editor.setName("AB"); editor.setName("ABC");
    editor.setDescription("Description");
    editor.undo(); expect(editor.draft.value.description).toBeUndefined();
    editor.undo(); expect(editor.draft.value.name).toBe("Original");
    editor.redo(); expect(editor.draft.value.name).toBe("ABC");
    editor.setName("New branch");
    expect(editor.canRedo.value).toBe(false);
    editor.undo(); expect(editor.draft.value.name).toBe("ABC");
  });

  it("preserves a restored JSON draft across revisions without rolling back persistence metadata", async () => {
    const save = vi.fn(async (value: ReportTemplateDocument) => ({ ...value, revision: "2" }));
    const { editor } = harness(save);
    editor.json.value = JSON.stringify({ ...document(), name: "JSON edit" });
    editor.undo(); editor.redo();
    editor.applyJson();
    await editor.save();
    editor.undo();
    expect(editor.draft.value.revision).toBe("2");
    expect(editor.jsonPending.value).toBe(true);
    editor.applyJson();
    expect(editor.error.value).toBe("");
    expect(editor.draft.value).toMatchObject({ name: "JSON edit", revision: "2" });
    editor.json.value = JSON.stringify({ ...editor.draft.value, revision: "999" });
    editor.applyJson();
    expect(editor.error.value).toContain("修订号");
    expect(editor.draft.value.revision).toBe("2");
  });

  it("keeps template replacement as one undoable change and preserves document identity", () => {
    const { editor } = harness();
    const replacement = createTableTemplate({ columns: [{ field: "weight", header: "Weight" }] });
    expect(editor.applyTemplate(replacement)).toBe(true);
    expect(editor.draft.value).toMatchObject({ id: "session", revision: "1", name: "Original" });
    expect(editor.activeList.value?.columns[0]?.field).toBe("weight");
    editor.undo(); expect(editor.activeList.value?.columns[0]?.field).toBe("heat");
  });

  it("coalesces preview invalidations during typing while direct reads use the current content", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { editor } = harness();
    editor.setColumn(0, "header", "A"); await nextTick();
    const first = editor.fetcher.value;
    editor.setColumn(0, "header", "AB"); await nextTick();
    editor.setColumn(0, "header", "ABC"); await nextTick();
    expect(editor.fetcher.value).toBe(first);
    // Force cooperative source processing to yield independently of machine load.
    let elapsed = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => elapsed += 10);
    cleanup.push(() => clock.mockRestore());
    const pending = editor.fetcher.value!({ reportIds: ["draft"], params: {} });
    // Both the 150ms preview debounce and processing's zero-delay yields use
    // these fake timers; awaiting the query first would deadlock on its yield.
    await vi.advanceTimersByTimeAsync(150);
    const plan = await pending;
    expect(JSON.stringify(plan)).toContain("ABC");
    await flushPromises();
    expect(editor.fetcher.value).not.toBe(first);
    editor.undo(); expect(editor.activeList.value?.columns[0]?.header).toBe("Heat");
  });
});

describe("designer keyboard ownership", () => {
  it("handles undo and redo in the canvas, preserving native text editing and IME composition", () => {
    const undo = vi.fn(), redo = vi.fn();
    const shortcuts = useDesignerShortcuts(() => ({ undo, redo, canUndo: true, canRedo: true }));
    const root = globalThis.document.createElement("div"), input = globalThis.document.createElement("input");
    root.append(input);
    root.addEventListener("keydown", shortcuts.keydown);
    const send = (target: HTMLElement, options: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true, ...options });
      target.dispatchEvent(event); return event.defaultPrevented;
    };
    expect(send(input, {})).toBe(false);
    expect(send(root, { isComposing: true })).toBe(false);
    expect(send(root, { altKey: true })).toBe(false);
    expect(send(root, {})).toBe(true);
    expect(send(root, { ctrlKey: false, metaKey: true, shiftKey: true })).toBe(true);
    expect(send(root, { key: "y" })).toBe(true);
    expect(undo).toHaveBeenCalledOnce(); expect(redo).toHaveBeenCalledTimes(2);
  });
});
