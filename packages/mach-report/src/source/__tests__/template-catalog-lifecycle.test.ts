// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createLocalTemplateCatalog, createTableTemplate, defineReportTemplate } from "../../index";
function document(revision: string, name = "生产日报") { return defineReportTemplate({ id: "daily", name, revision, template: createTableTemplate({ columns: [{ field: "a", header: "A" }] }) }); }
describe("local template catalog lifecycle", () => {
  it("isolates the current draft and published document with explicit lifecycle metadata", async () => {
    const provider = createLocalTemplateCatalog([{ document: document("3", "草稿"), draftRevision: "3", published: document("2", "发布版"), publishedRevision: "2" }]);
    expect((await provider.search({})).items[0]).toMatchObject({ revision: "3", draftRevision: "3", publishedRevision: "2" });
    const editable = await provider.get("daily", {}); expect(editable?.name).toBe("草稿"); editable!.name = "外部改动";
    expect((await provider.get("daily", { mode: "edit" }))?.name).toBe("草稿");
    expect((await provider.get("daily", { mode: "published" }))?.name).toBe("发布版");
  });
  it("supports published-only and legacy entries without inventing publication status", async () => {
    const published = createLocalTemplateCatalog([{ document: document("2"), publishedRevision: "2" }]);
    expect(await published.get("daily", { mode: "published" })).toEqual(document("2"));
    const legacy = createLocalTemplateCatalog([{ document: document("2") }]);
    expect(await legacy.get("daily", {})).toEqual(document("2"));
    expect(await legacy.get("daily", { mode: "published" })).toBeUndefined();
    expect((await legacy.search({})).items[0]).not.toHaveProperty("publishedRevision");
  });
  it("rejects mismatched lifecycle identity or revisions", () => {
    expect(() => createLocalTemplateCatalog([{ document: document("3"), draftRevision: "2" }])).toThrow("草稿修订");
    expect(() => createLocalTemplateCatalog([{ document: document("3"), publishedRevision: "2" }])).toThrow("独立文档");
    expect(() => createLocalTemplateCatalog([{ document: document("3"), published: { ...document("2"), id: "another" } }])).toThrow("身份或修订");
    expect(() => createLocalTemplateCatalog([{ document: document("3"), published: document("2"), publishedRevision: "1" }])).toThrow("身份或修订");
  });
});
