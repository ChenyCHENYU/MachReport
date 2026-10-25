// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createMemoryTemplateStore, createTemplateManager, createTemplateMigrator, createTableTemplate, defineReportTemplate, type ReportTemplateMigration } from "../index";

const current = () => defineReportTemplate({ id: "a", name: "Template", template: createTableTemplate({ columns: [{ field: "name", header: "Name" }] }) });
const steps: ReportTemplateMigration[] = [
  { from: "0.8", to: "0.9", migrate: input => ({ ...input, schemaVersion: "0.9", description: "migrated" }) },
  { from: "0.9", to: "1.0", migrate: async input => ({ ...input, schemaVersion: "1.0" }) }
];
describe("explicit template schema migration", () => {
  it("migrates a bounded chain without mutating the input and validates the final schema", async () => {
    const input = { ...current(), schemaVersion: "0.8" };
    const result = await createTemplateMigrator(steps)(input);
    expect(result.document).toMatchObject({ schemaVersion: "1.0", description: "migrated" });
    expect(result.steps).toEqual([{ from: "0.8", to: "0.9" }, { from: "0.9", to: "1.0" }]);
    expect(input.schemaVersion).toBe("0.8");
    expect((await createTemplateMigrator()(JSON.stringify(current()))).steps).toEqual([]);
    await expect(createTemplateMigrator(steps)({ ...input, template: null })).rejects.toThrow();
  });
  it("rejects ambiguous, cyclic, unreachable, future and identity-changing migrations", async () => {
    expect(() => createTemplateMigrator([steps[0]!, steps[0]!])).toThrow(/唯一/);
    expect(() => createTemplateMigrator([{ ...steps[0]!, to: "0.7" }])).toThrow(/当前/);
    expect(() => createTemplateMigrator([{ ...steps[0]!, to: "0.9" }, { ...steps[1]!, to: "0.8" }])).toThrow(/循环/);
    expect(() => createTemplateMigrator([{ ...steps[0]!, from: "1.0" }])).toThrow(/降级/);
    await expect(createTemplateMigrator(steps)({ ...current(), schemaVersion: "9.0" })).rejects.toMatchObject({ code: "unsupported" });
    await expect(createTemplateMigrator([{ from: "0.9", to: "1.0", migrate: input => ({ ...input, id: "other", schemaVersion: "1.0" }) }])({ ...current(), schemaVersion: "0.9" })).rejects.toMatchObject({ code: "result" });
    await expect(createTemplateMigrator([{ from: "0.9", to: "1.0", migrate: input => input }])({ ...current(), schemaVersion: "0.9" })).rejects.toMatchObject({ code: "result" });
  });
  it("integrates save/read/publish/rollback while retaining the legacy save callback", async () => {
    const store = createMemoryTemplateStore(), legacy = vi.fn(input => input);
    const manager = createTemplateManager(store, { migrations: steps, migrate: legacy });
    await manager.saveDraft({ ...current(), schemaVersion: "0.8" }, { expectedRevision: null });
    await manager.publish("a", { expectedRevision: "1" });
    expect((await manager.get("a"))?.schemaVersion).toBe("1.0");
    await manager.rollback("a", "2", { expectedRevision: "2" });
    expect(legacy).toHaveBeenCalledTimes(1);
    expect((await manager.history("a"))).toHaveLength(2);
    const original = { id: "old", revision: "1", publishedRevision: "1", published: { ...current(), id: "old", schemaVersion: "0.9" } };
    await store.compareAndSwap("old", null, original as never, {});
    expect((await manager.get("old"))?.schemaVersion).toBe("1.0");
    expect((await store.read("old"))?.published?.schemaVersion).toBe("0.9");
  });
  it("rejects accessors and malformed JSON before running host migration", async () => {
    const run = vi.fn(input => input), input = { ...current(), schemaVersion: "0.9" };
    Object.defineProperty(input, "name", { enumerable: true, get() { throw new Error("accessed"); } });
    await expect(createTemplateMigrator([{ from: "0.9", to: "1.0", migrate: run }])(input)).rejects.toThrow(/访问器/);
    expect(run).not.toHaveBeenCalled();
    await expect(createTemplateMigrator()("{")).rejects.toThrow(/语法/);
    await expect(createTemplateMigrator()([])).rejects.toThrow(/对象/);
  });
  it("does not enter publication review after cancellation during migration of a stored previous version", async () => {
    const store = createMemoryTemplateStore(), controller = new AbortController(), review = vi.fn(() => ({ ok: true, issues: [], samples: [] }));
    await store.compareAndSwap("a", null, { id: "a", revision: "1", draft: current(), publishedRevision: "old", published: { ...current(), schemaVersion: "0.9" } } as never, {});
    const manager = createTemplateManager(store, { beforePublish: review, migrations: [{ from: "0.9", to: "1.0", migrate: async input => { controller.abort(); return { ...input, schemaVersion: "1.0" }; } }] });
    await expect(manager.publish("a", { expectedRevision: "1", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(review).not.toHaveBeenCalled(); expect((await store.read("a"))?.revision).toBe("1");
  });
});
