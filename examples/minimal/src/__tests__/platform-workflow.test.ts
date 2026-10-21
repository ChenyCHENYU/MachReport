// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMemoryTemplateStore, createTemplate, createTemplateManager, defineReportTemplate, type ReportTemplateDocument } from "@agile-team/mach-report";
import { createMemoryReportInstanceStore } from "@agile-team/mach-report/server";
import { createLocalInstanceIdentities, createLocalPublishedBatch, createManagerTemplateCatalog, saveAndPublishTemplate } from "../platform-workflow";

const template = defineReportTemplate({ id: "业务/报表", name: "原始模板", template: {
  ...createTemplate().page(100, 80).list("rows", { leftMm: 5, topMm: 5, widthMm: 70 }, [{ field: "amount", header: "金额", widthMm: 70 }]).build(),
  params: [{ field: "month", type: "month", defaultValue: "2026-10" }],
} });
const signal = () => new AbortController().signal;
async function publishedTemplate() {
  const manager = createTemplateManager(createMemoryTemplateStore());
  const draft = await manager.saveDraft(template, { expectedRevision: null });
  const published = await manager.publish(draft.id, { expectedRevision: draft.revision });
  return { manager, published: published.published! };
}

describe("local product workflow integration", () => {
  it("keeps a stable catalog current, reopens the latest draft with its CAS baseline and exposes the separate publication", async () => {
    const { manager, published } = await publishedTemplate(), provider = createManagerTemplateCatalog(manager);
    expect((await provider.search({})).items[0]).toMatchObject({ revision: "2", publishedRevision: "2" });
    const draft = await manager.saveDraft({ ...published, name: "继续编辑的草稿" }, { expectedRevision: "2" });
    const page = await provider.search({ query: "继续编辑" });
    expect(page.items[0]).toMatchObject({ name: "继续编辑的草稿", revision: "3", draftRevision: "3", publishedRevision: "2" });
    const reopened = await provider.get(published.id, { mode: "edit" });
    expect(reopened).toEqual(draft.draft);
    expect(await provider.get(published.id, { mode: "published" })).toEqual(published);
    const next = await manager.saveDraft({ ...reopened!, name: "再次保存成功" }, { expectedRevision: reopened!.revision! });
    expect(next.revision).toBe("4");
    expect((await provider.get(published.id, {}))?.name).toBe("再次保存成功");
  });
  it("reads newly copied draft-only templates and forwards cancellation instead of returning a stale cached catalog", async () => {
    const manager = createTemplateManager(createMemoryTemplateStore()), provider = createManagerTemplateCatalog(manager);
    expect((await provider.search({})).items).toEqual([]);
    await manager.saveDraft(template, { expectedRevision: null });
    expect((await provider.search({})).items[0]).toMatchObject({ draftRevision: "1" });
    expect(await provider.get(template.id, { mode: "published" })).toBeUndefined();
    const controller = new AbortController(); controller.abort();
    await expect(provider.search({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
  it("uses bounded opaque IDs for tuples without concat collisions, unsafe characters or length overflow", () => {
    const identities = createLocalInstanceIdentities(2);
    const first = identities.forCase("a-b", "c"), second = identities.forCase("a", "b-c");
    expect(first).not.toBe(second); expect(first).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/);
    expect(identities.forCase("a-b", "c")).toBe(first);
    expect(() => identities.forCase("third", "intent")).toThrow("上限");
    expect(createLocalInstanceIdentities().forCase("中文模板/".repeat(40), "case")).toMatch(/^instance-/);
  });
  it("reuses only matching committed intents, preserves immutable publication and never overwrites changed params or revisions", async () => {
    const { published } = await publishedTemplate(), store = createMemoryReportInstanceStore(), identities = createLocalInstanceIdentities();
    const original = structuredClone(published), batch = createLocalPublishedBatch(published, { rows: [{ amount: 0 }] }, store, identities);
    published.name = "外部后续修改"; batch.document.revision = "999";
    const first = await batch.execute({ id: "same", params: {} }, { signal: signal() });
    expect(first.label).toBe("原始模板 · 2026-10");
    expect(await batch.execute({ id: "same", params: { month: "2026-10" } }, { signal: signal() })).toEqual(first);
    await expect(batch.execute({ id: "same", params: { month: "2026-11" } }, { signal: signal() })).rejects.toMatchObject({ code: "conflict" });
    const newer = createLocalPublishedBatch({ ...original, revision: "4" }, { rows: [{ amount: 1 }] }, store, identities);
    await expect(newer.execute({ id: "same", params: { month: "2026-10" } }, { signal: signal() })).rejects.toMatchObject({ code: "conflict" });
    const copy = await newer.execute({ id: "copied-new-intent", params: { month: "2026-10" } }, { signal: signal() });
    expect(copy.instanceId).not.toBe(first.instanceId);
    expect((await store.list("local-demo", { limit: 100 })).items).toHaveLength(2);
    expect((await store.read("local-demo", first.instanceId))?.templateRevisions).toEqual({ [original.id]: "2" });
    expect((await store.read("local-demo", first.instanceId))?.revision).toBe(1);
  });
  it("concurrent identical attempts converge on one saved snapshot and pre-cancelled calls do not create instances", async () => {
    const { published } = await publishedTemplate(), store = createMemoryReportInstanceStore();
    const batch = createLocalPublishedBatch(published, { rows: [{ amount: 0 }] }, store, createLocalInstanceIdentities());
    const receipts = await Promise.all([1, 2].map(() => batch.execute({ id: "one-intent", params: {} }, { signal: signal() })));
    expect(receipts[0]).toEqual(receipts[1]); expect((await store.list("local-demo")).items).toHaveLength(1);
    const controller = new AbortController(); controller.abort();
    await expect(batch.execute({ id: "cancelled", params: {} }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect((await store.list("local-demo")).items).toHaveLength(1);
  });
  it("blocks publication when save is swallowed, leaves a dirty tool, remains saving or remains blocked", async () => {
    const { manager, published } = await publishedTemplate(), publish = vi.spyOn(manager, "publish");
    for (const state of [{ pendingLocalChanges: true, swallowed: true }, { pendingLocalChanges: true }, { pendingLocalChanges: false, saving: true }, { pendingLocalChanges: false, blocked: true }]) {
      let saves = 0;
      const editor = { ...state, save: async () => { if (!state.swallowed) saves++; }, guardChanges: async () => true, reset: async () => {} };
      await expect(saveAndPublishTemplate({ editor, manager, document: () => published, successfulSaves: () => saves, afterSave: async () => {} })).rejects.toThrow("草稿尚未保存");
    }
    expect(publish).not.toHaveBeenCalled();
  });
  it("publishes an already saved clean draft without requiring another editor save event", async () => {
    const manager = createTemplateManager(createMemoryTemplateStore());
    const draft = await manager.saveDraft(template, { expectedRevision: null });
    const editor = { pendingLocalChanges: false, save: vi.fn(async () => {}), guardChanges: async () => true, reset: async () => {} };
    const result = await saveAndPublishTemplate({ editor, manager, document: () => draft.draft!, successfulSaves: () => 0, afterSave: async () => {} });
    expect(result.published).toMatchObject({ id: template.id, revision: "2" });
    expect(editor.save).not.toHaveBeenCalled();
  });
  it("waits for a successful editor save and the updated model revision before publishing with CAS", async () => {
    const { manager, published } = await publishedTemplate();
    let document: ReportTemplateDocument = published, saves = 0;
    const editor = { pendingLocalChanges: true, save: async () => {
      const next = await manager.saveDraft({ ...document, name: "已更新" }, { expectedRevision: document.revision! });
      saves++; queueMicrotask(() => { document = next.draft!; editor.pendingLocalChanges = false; });
    }, guardChanges: async () => true, reset: async () => {} };
    const next = await saveAndPublishTemplate({ editor, manager, document: () => document, successfulSaves: () => saves, afterSave: async () => {} });
    expect(next.published).toMatchObject({ name: "已更新", revision: "4" });
    expect((await manager.history(document.id)).map(item => item.revision)).toEqual(["2", "4"]);
  });
});
