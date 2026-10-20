import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneReportTemplate, createLocalTemplateCatalog, createMemoryTemplateStore, createTemplateManager, createTableTemplate, defineReportTemplate, type ReportTemplateCatalogProvider } from "../../index";
import ReportTemplateLibrary from "../ReportTemplateLibrary.vue";
function document(id: string, name: string) { return defineReportTemplate({ id, name, revision: "3", template: createTableTemplate({ columns: [{ field: "a", header: "A" }] }) }); }
afterEach(() => vi.useRealTimers());
describe("template catalog and library", () => {
  it("binds paging to the current search and refuses an old next button during the debounce interval", async () => {
    vi.useFakeTimers();
    const search = vi.fn(async (request: Parameters<ReportTemplateCatalogProvider["search"]>[0]) => ({ items: [document(request.query ? "new" : "old", request.query ? "新模板" : "旧模板")], next: request.query ? undefined : "old-cursor" }));
    const wrapper = mount(ReportTemplateLibrary, { props: { provider: { search, get: async () => undefined } } }); await flushPromises();
    const oldNext = wrapper.findAll("button").find(button => button.text() === "下一页")!;
    await wrapper.get('input[type="search"]').setValue("新");
    expect(wrapper.findAll("li")).toHaveLength(0); await oldNext.trigger("click"); expect(search).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180); await flushPromises();
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: "新", cursor: undefined }));
    expect(wrapper.text()).toContain("新模板"); expect(wrapper.text()).not.toContain("旧模板"); wrapper.unmount();
  });
  it("replaces remote pages instead of accumulating every loaded template in the DOM", async () => {
    const provider = createLocalTemplateCatalog(Array.from({ length: 65 }, (_, index) => ({ document: document(`id-${String(index).padStart(3, "0")}`, `模板 ${index}`) })));
    const wrapper = mount(ReportTemplateLibrary, { props: { provider } }); await flushPromises();
    expect(wrapper.findAll("li")).toHaveLength(30);
    await wrapper.findAll("button").find(button => button.text() === "下一页")!.trigger("click"); await flushPromises();
    expect(wrapper.findAll("li")).toHaveLength(30); expect(wrapper.findAll("li")[0]!.text()).toContain("id-030");
    await wrapper.findAll("button").find(button => button.text() === "下一页")!.trigger("click"); await flushPromises();
    expect(wrapper.findAll("li")).toHaveLength(5); expect(wrapper.findAll("li")[0]!.text()).toContain("id-060");
    await wrapper.findAll("button").find(button => button.text() === "上一页")!.trigger("click"); await flushPromises();
    expect(wrapper.findAll("li")).toHaveLength(30); expect(wrapper.findAll("li")[0]!.text()).toContain("id-030"); wrapper.unmount();
  });
  it("never sends a pending copy through a replaced persistence callback or submits a copy twice", async () => {
    const original = document("source", "原模板"); let resolve!: (value: typeof original) => void; let signal: AbortSignal | undefined;
    const get = vi.fn((_id: string, context: { signal?: AbortSignal }) => { signal = context.signal; return new Promise<typeof original>(done => { resolve = done; }); });
    const provider = { search: async () => ({ items: [original] }), get };
    const oldCreate = vi.fn(async (value: typeof original) => value), newCreate = vi.fn(async (value: typeof original) => value);
    const wrapper = mount(ReportTemplateLibrary, { props: { provider, create: oldCreate } }); await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "复制模板")!.trigger("click");
    await wrapper.findAll("form input")[0]!.setValue("copy"); await wrapper.get("form").trigger("submit"); await wrapper.get("form").trigger("submit");
    expect(get).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ create: newCreate }); expect(signal?.aborted).toBe(true);
    resolve(original); await flushPromises();
    expect(oldCreate).not.toHaveBeenCalled(); expect(newCreate).not.toHaveBeenCalled(); expect(wrapper.emitted("open")).toBeUndefined(); wrapper.unmount();
  });
  it("searches metadata, filters categories, returns isolated pages and clones without source revision", async () => {
    const source = document("cost", "成本月报"), provider = createLocalTemplateCatalog([{ document: source, category: "成本", tags: ["月报"] }, { document: document("production", "产量日报"), category: "生产" }]);
    const page = await provider.search({ query: "月报" });
    expect(page.items.map(item => item.id)).toEqual(["cost"]); page.items[0]!.name = "changed";
    expect((await provider.get("cost", {}))?.name).toBe("成本月报");
    expect((await provider.search({ category: "生产" })).items[0]?.id).toBe("production");
    const first = await provider.search({ limit: 1 }); expect(first.next).toBe("cost");
    expect((await provider.search({ cursor: first.next, limit: 1 })).items[0]?.id).toBe("production");
    expect(cloneReportTemplate(source, { id: "cost-copy", name: "副本" })).not.toHaveProperty("revision");
    expect(() => cloneReportTemplate(source, { id: "cost", name: "wrong" })).toThrow("新的 ID");
  });
  it("opens validated templates and creates copies through a real CAS persistence action", async () => {
    const provider = createLocalTemplateCatalog([{ document: document("daily", "日报"), category: "生产" }]);
    const manager = createTemplateManager(createMemoryTemplateStore());
    const create = vi.fn(async (candidate: ReturnType<typeof document>) => (await manager.saveDraft(candidate, { expectedRevision: null })).draft!);
    const wrapper = mount(ReportTemplateLibrary, { props: { provider, create } }); await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "打开设计器")!.trigger("click"); await flushPromises();
    expect(wrapper.emitted("open")?.[0]?.[0]).toMatchObject({ id: "daily", revision: "3" });
    await wrapper.findAll("button").find(button => button.text() === "复制模板")!.trigger("click");
    const inputs = wrapper.findAll("form input"); await inputs[0]!.setValue("daily-copy"); await inputs[1]!.setValue("新日报");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(create).toHaveBeenCalledTimes(1);
    expect(await manager.get("daily-copy", { draft: true })).toMatchObject({ name: "新日报", revision: "1" });
    expect(wrapper.emitted("open")?.at(-1)?.[0]).toMatchObject({ id: "daily-copy", revision: "1" }); wrapper.unmount();
  });
  it("suppresses late responses and aborts on provider replacement/unmount", async () => {
    let resolve: ((page: Awaited<ReturnType<ReportTemplateCatalogProvider["search"]>>) => void) | undefined;
    let signal: AbortSignal | undefined;
    const slow: ReportTemplateCatalogProvider = { search: request => { signal = request.signal; return new Promise(done => { resolve = done; }); }, get: async () => undefined };
    const wrapper = mount(ReportTemplateLibrary, { props: { provider: slow } });
    await wrapper.setProps({ provider: createLocalTemplateCatalog([{ document: document("new", "新模板") }]) }); await flushPromises();
    expect(signal?.aborted).toBe(true);
    resolve!({ items: [document("old", "旧模板")] }); await flushPromises();
    expect(wrapper.text()).toContain("新模板"); expect(wrapper.text()).not.toContain("旧模板"); wrapper.unmount();
  });
});
