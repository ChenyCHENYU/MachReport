// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { defineReportTemplate } from "../source/template-registry";
import { diffReportTemplates } from "../source/template-diff";
import { reviewReportTemplate } from "../source/template-review";
import { createReportSource } from "../source/report-source";
import { createMemoryTemplateStore, createTemplateManager } from "../source/template-store";

const document = () => defineReportTemplate({ id: "review", name: "Daily", template: createTableTemplate({ columns: [{ field: "code", header: "炉号" }, { field: "weight", header: "重量", format: { kind: "number", digits: 3 } }] }) });
const schema = { detail: { fields: [{ field: "code", type: "text" as const }, { field: "weight", type: "number" as const }] } };

describe("template publication review", () => {
  it("classifies column reorder separately from deletion, formatting and field remapping", () => {
    const before = document(), after = document();
    const list = after.template.pages[0]!.components.find((item) => item.kind === "list")!;
    if (list.kind !== "list") throw new Error("fixture");
    list.columns.reverse(); list.columns[0]!.format = { kind: "number", digits: 2 };
    after.revision = "next";
    const diff = diffReportTemplates(before, after);
    expect(diff.changes.filter((change) => change.kind === "moved")).toHaveLength(2);
    expect(diff.breakingChanges).toBe(0);
    expect(diff.changes.some((change) => change.category === "format")).toBe(true);
    list.columns.pop();
    const removed = diffReportTemplates(before, after, { maxChanges: 1 });
    expect(removed.truncated).toBe(true); expect(removed.breakingChanges).toBe(1);
    expect(removed.totalChanges).toBeGreaterThan(removed.changes.length);
  });

  it("checks declared fields, types, zero/null and actual layout/output capabilities", () => {
    const valid = reviewReportTemplate(document(), { dataSchemas: schema, fixtures: [{ name: "real-zero", datasets: { detail: [{ code: "001", weight: 0 }, { code: "002", weight: null }] } }] });
    expect(valid.ok).toBe(true); expect(valid.samples[0]?.rows).toBe(2);
    const wrong = reviewReportTemplate(document(), { dataSchemas: { detail: { fields: [{ field: "code", type: "text" }] } } });
    expect(wrong.ok).toBe(false); expect(wrong.issues).toContainEqual(expect.objectContaining({ code: "field", field: "weight" }));
    const typed = reviewReportTemplate(document(), { dataSchemas: schema, fixtures: [{ name: "bad", datasets: { detail: [{ code: "001", weight: "0" }] } }] });
    expect(typed.ok).toBe(false); expect(typed.samples).toHaveLength(0);
  });

  it("validates fixture query parameters with the same contract as runtime and reports the exact fixture path", async () => {
    const current = document();
    current.template.params = [{ field: "reportDate", type: "date", required: true }, { field: "limit", type: "number", min: 1, max: 10, defaultValue: "3" }];
    const datasets = { detail: [{ code: "001", weight: 0 }] };
    const invalid = reviewReportTemplate(current, { fixtures: [{ name: "bad-date", datasets, params: { reportDate: "wrong" } }, { name: "missing-date", datasets, params: { limit: "0" } }] });
    expect(invalid.ok).toBe(false); expect(invalid.samples).toEqual([]);
    expect(invalid.issues).toContainEqual(expect.objectContaining({ code: "params", field: "reportDate", path: "$.fixtures[0].params.reportDate", fixture: "bad-date" }));
    expect(invalid.issues).toContainEqual(expect.objectContaining({ code: "params", field: "reportDate", path: "$.fixtures[1].params.reportDate", fixture: "missing-date" }));
    expect(invalid.issues).toContainEqual(expect.objectContaining({ code: "params", field: "limit", path: "$.fixtures[1].params.limit" }));
    const runtime = createReportSource({ review: { template: current.template, datasets } });
    await expect(runtime({ reportIds: ["review"], params: { reportDate: "wrong" } })).rejects.toMatchObject({ code: "params" });
    expect(reviewReportTemplate(current, { fixtures: [{ name: "valid", datasets, params: { reportDate: "2026-10-20" } }] }).ok).toBe(true);
  });

  it("stops actual server publication before encoding when fixture parameters are invalid", async () => {
    const current = document(); current.template.params = [{ field: "reportDate", type: "date", required: true }];
    const { reviewReportPublication } = await import("../server/publication");
    const review = await reviewReportPublication(current, { formats: ["xlsx"], fixtures: [{ name: "bad-date", params: { reportDate: "2026-02-30" }, datasets: { detail: [{ code: "001", weight: 0 }] } }] });
    expect(review.ok).toBe(false); expect(review.issues).toContainEqual(expect.objectContaining({ code: "params", path: "$.fixtures[0].params.reportDate" }));
    expect(review.artifacts).toEqual([]);
  });

  it("marks an untested template honestly and does not silently truncate samples", () => {
    expect(reviewReportTemplate(document()).issues).toContainEqual(expect.objectContaining({ code: "sample", severity: "warning" }));
    const result = reviewReportTemplate(document(), { maxSampleRows: 1, fixtures: [{ name: "too-big", datasets: { detail: [{}, {}] } }] });
    expect(result.ok).toBe(false); expect(result.samples).toHaveLength(0);
    expect(reviewReportTemplate(document(), { maxPages: 0 }).ok).toBe(false);
  });

  it("validates only referenced datasets but checks formula and relationship source fields", () => {
    const current = document();
    const fixtures = [{ name: "used-only", datasets: { detail: [{ code: "001", weight: 0 }] } }];
    expect(reviewReportTemplate(current, { dataSchemas: { ...schema, unused: { fields: [{ field: "mandatory", type: "text", required: true }] } }, fixtures }).ok).toBe(true);
    const list = current.template.pages[0]!.components.find((item) => item.kind === "list")!;
    if (list.kind !== "list") throw new Error("fixture");
    list.computed = [{ field: "calculated", expression: { op: "add", args: [{ field: "missingInput" }, { value: 1 }] } }];
    list.columns.push({ field: "calculated", header: "calculated", widthMm: 20 });
    const result = reviewReportTemplate(current, { dataSchemas: schema });
    expect(result.ok).toBe(false); expect(result.issues).toContainEqual(expect.objectContaining({ code: "field", field: "missingInput" }));
  });

  it("requires compatibility confirmation for an entire removed report section", () => {
    const previous = document(), next = document(); next.template.pages[0]!.components = next.template.pages[0]!.components.filter((item) => item.kind !== "list");
    expect(diffReportTemplates(previous, next).breakingChanges).toBeGreaterThan(0);
    expect(reviewReportTemplate(next, { previous }).ok).toBe(false);
  });

  it("does not let summary aliases masquerade as row formula source fields", () => {
    const current = document();
    const list = current.template.pages[0]!.components.find((item) => item.kind === "list")!;
    if (list.kind !== "list") throw new Error("fixture");
    list.groups = [{ field: "code", aggregates: [{ field: "alias", valueField: "weight", op: "sum" }] }];
    list.columns.push({ field: "alias", header: "Summary only", widthMm: 10 });
    expect(reviewReportTemplate(current, { dataSchemas: schema }).ok).toBe(true);
    list.computed = [{ field: "out", expression: { op: "add", args: [{ field: "alias" }, { value: 1 }] } }];
    expect(reviewReportTemplate(current, { dataSchemas: schema }).issues).toContainEqual(expect.objectContaining({ code: "field", field: "alias" }));
  });

  it("flags required query parameters and changed parameter contracts as compatibility changes", () => {
    const previous = document(), current = document();
    current.template.params = [{ field: "date", type: "date", required: true }];
    expect(diffReportTemplates(previous, current).breakingChanges).toBeGreaterThan(0);
    previous.template.params = [{ field: "date", type: "text" }];
    expect(reviewReportTemplate(current, { previous }).ok).toBe(false);
    expect(reviewReportTemplate(current, { previous, allowBreakingChanges: true }).ok).toBe(true);
  });

  it("requires explicit compatibility acknowledgement and locates static image output issues", () => {
    const before = document(), after = document();
    const list = after.template.pages[0]!.components.find((item) => item.kind === "list")!;
    if (list.kind !== "list") throw new Error("fixture");
    list.columns[0]!.field = "heat";
    expect(reviewReportTemplate(after, { previous: before }).ok).toBe(false);
    expect(reviewReportTemplate(after, { previous: before, allowBreakingChanges: true }).ok).toBe(true);
    after.template.pages[0]!.components.unshift({ kind: "image", nid: "logo", leftMm: 1, topMm: 1, widthMm: 5, heightMm: 5 });
    const checked = reviewReportTemplate(after, { strictOutputs: true, formats: ["pdf"], fixtures: [{ name: "image", datasets: { detail: [] } }] });
    expect(checked.ok).toBe(false);
    expect(checked.issues).toContainEqual(expect.objectContaining({ code: "output", pageIndex: 0, componentIndex: 0 }));
  });

  it("runs the publication gate before CAS including rollback, and preserves the draft on failure", async () => {
    const store = createMemoryTemplateStore();
    let allowed = false;
    const manager = createTemplateManager(store, { beforePublish: ({ document: draft }) => ({ ...reviewReportTemplate(draft), ok: allowed }) });
    await manager.saveDraft(document(), { expectedRevision: null });
    await expect(manager.publish("review", { expectedRevision: "1" })).rejects.toMatchObject({ code: "review" });
    expect((await store.read("review"))?.revision).toBe("1");
    allowed = true; await manager.publish("review", { expectedRevision: "1" });
    allowed = false;
    await expect(manager.rollback("review", "2", { expectedRevision: "2" })).rejects.toMatchObject({ code: "review" });
    expect((await store.history("review"))).toHaveLength(1);
  });

  it("locks the expected revision while an asynchronous publication review is in progress", async () => {
    const store = createMemoryTemplateStore();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const manager = createTemplateManager(store, { beforePublish: async ({ document: draft }) => { await waiting; return reviewReportTemplate(draft); } });
    await manager.saveDraft(document(), { expectedRevision: null });
    const mutation = { expectedRevision: "1" };
    const publishing = manager.publish("review", mutation);
    mutation.expectedRevision = "999";
    release();
    expect((await publishing).publishedRevision).toBe("2");
    expect((await store.history("review"))).toHaveLength(1);
  });
});
