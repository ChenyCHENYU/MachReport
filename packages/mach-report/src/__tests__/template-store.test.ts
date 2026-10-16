// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTemplate } from "../builder/template-builder";
import { defineReportTemplate } from "../source/template-registry";
import { createMemoryTemplateStore, createTemplateManager } from "../source/template-store";

function document(name: string) {
  return defineReportTemplate({ id: "sales", name, template: createTemplate().page(100, 80).text(name, { leftMm: 0, topMm: 0, widthMm: 30, heightMm: 10 }).build() });
}
describe("模板草稿、发布和存储 CAS", () => {
  it("草稿不影响发布版本，历史不受返回值修改影响，回滚创建新修订", async () => {
    const manager = createTemplateManager(createMemoryTemplateStore(), { now: () => new Date("2026-10-16T00:00:00Z") });
    expect((await manager.saveDraft(document("v1"), { expectedRevision: null })).revision).toBe("1");
    expect(await manager.get("sales")).toBeUndefined();
    expect((await manager.get("sales", { draft: true }))?.name).toBe("v1");
    await manager.publish("sales", { expectedRevision: "1" });
    await manager.saveDraft(document("v2"), { expectedRevision: "2" });
    expect((await manager.get("sales"))?.name).toBe("v1");
    await manager.publish("sales", { expectedRevision: "3" });
    const history = await manager.history("sales");
    history[0]!.document.name = "tampered";
    expect((await manager.history("sales"))[0]?.document.name).toBe("v1");
    const rolledBack = await manager.rollback("sales", "2", { expectedRevision: "4" });
    expect(rolledBack).toMatchObject({ revision: "5", publishedRevision: "5" });
    const restoredHistory = await manager.history("sales");
    expect(restoredHistory.map(({ revision }) => revision)).toEqual(["2", "4", "5"]);
    expect(restoredHistory[2]).toMatchObject({ revision: "5", restoredFrom: "2", document: { name: "v1", revision: "5" } });
  });
  it("并发写只能一个成功，失败写和非法模板都不改变历史", async () => {
    const manager = createTemplateManager(createMemoryTemplateStore());
    await manager.saveDraft(document("start"), { expectedRevision: null });
    const results = await Promise.allSettled([manager.saveDraft(document("a"), { expectedRevision: "1" }), manager.saveDraft(document("b"), { expectedRevision: "1" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
    await expect(manager.saveDraft({ id: "sales" }, { expectedRevision: "2" })).rejects.toThrow("模板校验失败");
    expect(await manager.history("sales")).toEqual([]);
  });
  it("迁移仅通过显式 hook，取消在 CAS 前生效，发布历史需存在", async () => {
    const manager = createTemplateManager(createMemoryTemplateStore(), { migrate: (input) => ({ ...(input as object), schemaVersion: "1.0" }) });
    await manager.saveDraft({ ...document("legacy"), schemaVersion: "0.1" }, { expectedRevision: null });
    await expect(manager.rollback("sales", "missing", { expectedRevision: "1" })).rejects.toMatchObject({ code: "history" });
    const controller = new AbortController(); controller.abort();
    await expect(manager.publish("sales", { expectedRevision: "1", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(await manager.list()).toEqual([{ id: "sales", revision: "1" }]);
  });
  it("草稿和发布不读取完整历史，回滚只读取指定版本", async () => {
    const store = createMemoryTemplateStore();
    const history = vi.spyOn(store, "history");
    const getVersion = vi.spyOn(store, "getVersion");
    const manager = createTemplateManager(store);
    await manager.saveDraft(document("v1"), { expectedRevision: null });
    await manager.publish("sales", { expectedRevision: "1" });
    await manager.saveDraft(document("v2"), { expectedRevision: "2" });
    expect(history).not.toHaveBeenCalled();
    const state = await manager.rollback("sales", "2", { expectedRevision: "3" });
    expect(state).toMatchObject({ revision: "4", published: { name: "v1" } });
    expect(state).not.toHaveProperty("history");
    expect(getVersion).toHaveBeenCalledWith("sales", "2", undefined);
    expect(history).not.toHaveBeenCalled();
  });
});
