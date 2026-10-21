import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createMemoryTemplateStore, createTableTemplate, createTemplateManager, defineReportTemplate, type ReportTemplateDocument } from "../../index";
import { useTemplateLibrary } from "../useTemplateLibrary";

function sourceDocument() {
  return defineReportTemplate({ id: "source", name: "产量日报", revision: "3", template: createTableTemplate({ columns: [{ field: "heat", header: "炉号" }] }) });
}

describe("template copy recovery after persistence", () => {
  it("retries opening a saved receipt without creating or loading the source twice", async () => {
    const source = sourceDocument(), manager = createTemplateManager(createMemoryTemplateStore());
    const get = vi.fn(async () => source);
    const create = vi.fn(async (candidate: ReportTemplateDocument) => (await manager.saveDraft(candidate, { expectedRevision: null })).draft!);
    const opened: ReportTemplateDocument[] = [];
    const open = vi.fn((document: ReportTemplateDocument) => {
      opened.push(structuredClone(document));
      if (opened.length === 1) { document.name = "宿主操作中的临时变更"; throw new Error("设计器暂时无法打开"); }
    });
    let library!: ReturnType<typeof useTemplateLibrary>;
    const wrapper = mount(defineComponent({ setup() {
      library = useTemplateLibrary({ provider: { search: async () => ({ items: [source] }), get }, create }, open);
      return () => h("div");
    } }));
    await flushPromises();
    library.beginCopy(source); library.newId.value = "copy"; library.newName.value = "产量日报副本";
    await flushPromises(); await library.load(source, true);
    expect(create).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1);
    expect(library.error.value).toBe("设计器暂时无法打开");
    expect(library.errorKind.value).toBe("open"); expect(library.retryLabel.value).toBe("重试打开模板");
    expect(library.copying.value).toBeUndefined();
    expect(await manager.get("copy", { draft: true })).toMatchObject({ name: "产量日报副本", revision: "1" });
    await library.retry(); await flushPromises();
    expect(create).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledTimes(2);
    expect(opened).toEqual([
      expect.objectContaining({ id: "copy", name: "产量日报副本", revision: "1" }),
      expect.objectContaining({ id: "copy", name: "产量日报副本", revision: "1" }),
    ]);
    expect(library.error.value).toBe(""); expect(library.busy.value).toBe(false);
    wrapper.unmount();
  });
});
