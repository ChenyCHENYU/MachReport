// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMemoryTemplateStore, createTemplate, createTemplateManager, defineReportTemplate, type ReportTemplateDocument } from "@agile-team/mach-report";
import { createMemoryReportInstanceStore, createReportWorkflow, createMemoryReportInstanceIds, createManagerTemplateCatalog, saveAndPublishReportTemplate } from "@agile-team/mach-report/server";

const template = defineReportTemplate({ id: "业务/报表", name: "原始模板", template: {
  ...createTemplate().page(100, 80).list("rows", { leftMm: 5, topMm: 5, widthMm: 70 }, [{ field: "amount", header: "金额", widthMm: 70 }]).build(),
  params: [{ field: "month", type: "month", defaultValue: "2026-10" }],
} });
const signal = () => new AbortController().signal;
async function setup() {
  const manager = createTemplateManager(createMemoryTemplateStore()), store = createMemoryReportInstanceStore();
  const draft = await manager.saveDraft(template, { expectedRevision: null });
  const published = (await manager.publish(draft.id, { expectedRevision: draft.revision })).published!;
  const workflow = createReportWorkflow({ templates: manager, instances: store, scope: "local-demo", data: { datasets: { rows: [{ amount: 0 }] } },
    title: (document, item, params) => `${document.name} · ${params.month ?? item.id}` });
  return { manager, store, published, workflow };
}

describe("package-owned product workflow", () => {
  it("opens the latest editable draft separately from the immutable publication", async () => {
    const { manager, published, workflow } = await setup(), provider = workflow.catalog;
    expect((await provider.search({})).items[0]).toMatchObject({ revision: "2", publishedRevision: "2" });
    const draft = await manager.saveDraft({ ...published, name: "继续编辑的草稿" }, { expectedRevision: "2" });
    expect((await provider.search({ query: "继续编辑" })).items[0]).toMatchObject({ name: "继续编辑的草稿", revision: "3", draftRevision: "3", publishedRevision: "2" });
    expect(await provider.get(published.id, { mode: "edit" })).toEqual(draft.draft);
    expect(await provider.get(published.id, { mode: "published" })).toEqual(published);
  });
  it("forwards cancellation, rejects draft-only generation and enforces the displayed publication revision", async () => {
    const { manager, workflow } = await setup();
    const controller = new AbortController(); controller.abort();
    await expect(workflow.catalog.search({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(workflow.batch(template.id, { expectedRevision: "1" })).rejects.toMatchObject({ code: "conflict" });
    await manager.saveDraft({ ...template, id: "draft-only" }, { expectedRevision: null });
    await expect(workflow.batch("draft-only")).rejects.toThrow("请先发布");
  });
  it("snapshots publication checks while awaiting the manager and refuses a template switch during save", async () => {
    const { manager, published, workflow } = await setup();
    const request = { expectedRevision: "1" };
    const batch = workflow.batch(template.id, request); request.expectedRevision = "2";
    await expect(batch).rejects.toMatchObject({ code: "conflict" });
    const publish = vi.spyOn(manager, "publish");
    let document = published, saves = 0;
    const editor = { pendingLocalChanges: true, save: async () => { document = { ...published, id: "another-template" }; saves++; editor.pendingLocalChanges = false; } };
    await expect(workflow.publish({ editor, document: () => document, successfulSaves: () => saves, afterSave: async () => {} })).rejects.toMatchObject({ code: "conflict" });
    expect(publish).not.toHaveBeenCalled();
  });
  it("uses bounded collision-free tuple identities", () => {
    const identities = createMemoryReportInstanceIds(2);
    const first = identities.forCase("a-b", "c");
    expect(first).not.toBe(identities.forCase("a", "b-c"));
    expect(identities.forCase("a-b", "c")).toBe(first);
    expect(createMemoryReportInstanceIds().forCase("a-b", "c")).not.toBe(first);
    expect(() => identities.forCase("third", "intent")).toThrow("上限");
    expect(createMemoryReportInstanceIds().forCase("中文模板/".repeat(40), "case")).toMatch(/^instance-/);
  });
  it("reuses committed intents and captures exact publications even after newer drafts and publications exist", async () => {
    const { published, manager, store, workflow } = await setup();
    const batch = await workflow.batch(published.id);
    published.name = "外部后续修改"; batch.document.revision = "999";
    const first = await batch.execute({ id: "same", params: {} }, { signal: signal() });
    expect(first.label).toBe("原始模板 · 2026-10");
    expect(await batch.execute({ id: "same", params: { month: "2026-10" } }, {})).toEqual(first);
    await expect(batch.execute({ id: "same", params: { month: "2026-11" } }, {})).rejects.toMatchObject({ code: "conflict" });
    const draft = await manager.saveDraft({ ...template, name: "新版" }, { expectedRevision: "2" });
    await manager.publish(template.id, { expectedRevision: draft.revision });
    const newer = await workflow.batch(template.id);
    await expect(newer.execute({ id: "same", params: {} }, {})).rejects.toMatchObject({ code: "conflict" });
    const copy = await newer.execute({ id: "new-intent", params: {} }, {});
    expect(copy.instanceId).not.toBe(first.instanceId);
    expect((await store.read("local-demo", first.instanceId))?.templateRevisions).toEqual({ [template.id]: "2" });
  });
  it("converges concurrent identical attempts and cancels before creating an instance", async () => {
    const { store, workflow } = await setup(), batch = await workflow.batch(template.id);
    const receipts = await Promise.all([1, 2].map(() => batch.execute({ id: "one", params: {} }, { signal: signal() })));
    expect(receipts[0]).toEqual(receipts[1]); expect((await store.list("local-demo")).items).toHaveLength(1);
    const controller = new AbortController(); controller.abort();
    await expect(batch.execute({ id: "cancelled", params: {} }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect((await store.list("local-demo")).items).toHaveLength(1);
  });
  it("blocks publication after swallowed saves, dirty tools or a blocked editor", async () => {
    const { manager, published } = await setup(), publish = vi.spyOn(manager, "publish");
    for (const state of [{ pendingLocalChanges: true, swallowed: true }, { pendingLocalChanges: true }, { pendingLocalChanges: false, saving: true }, { pendingLocalChanges: false, blocked: true }]) {
      let saves = 0;
      const editor = { ...state, save: async () => { if (!state.swallowed) saves++; } };
      await expect(saveAndPublishReportTemplate(manager, { editor, document: () => published, successfulSaves: () => saves, afterSave: async () => {} })).rejects.toThrow("草稿尚未保存");
    }
    expect(publish).not.toHaveBeenCalled();
  });
  it("publishes a clean saved draft without another save event and awaits dirty-save model synchronization", async () => {
    const { manager, workflow, published } = await setup();
    let document: ReportTemplateDocument = published, saves = 0;
    const editor = { pendingLocalChanges: true, save: async () => {
      const next = await manager.saveDraft({ ...document, name: "已更新" }, { expectedRevision: document.revision! });
      saves++; queueMicrotask(() => { document = next.draft!; editor.pendingLocalChanges = false; });
    } };
    const next = await workflow.publish({ editor, document: () => document, successfulSaves: () => saves, afterSave: async () => {} });
    expect(next.published).toMatchObject({ name: "已更新", revision: "4" });
    const draft = await manager.saveDraft(next.published!, { expectedRevision: "4" });
    const clean = { pendingLocalChanges: false, save: vi.fn() };
    await workflow.publish({ editor: clean, document: () => draft.draft!, successfulSaves: () => 0, afterSave: async () => {} });
    expect(clean.save).not.toHaveBeenCalled();
  });
  it("rejects an oversized local catalog before fetching all template bodies", async () => {
    const { manager } = await setup();
    const get = vi.spyOn(manager, "get");
    vi.spyOn(manager, "list").mockResolvedValue(Array.from({ length: 1001 }, (_, index) => ({ id: String(index), revision: "1" })));
    await expect(createManagerTemplateCatalog(manager).search({})).rejects.toThrow("1000");
    expect(get).not.toHaveBeenCalled();
  });
});
