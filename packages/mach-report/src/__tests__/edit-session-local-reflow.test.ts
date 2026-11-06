// @vitest-environment node
import { describe, expect, it, vi, afterEach } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { createReportSource } from "../source/report-source";
import { createReportCellEditBatch } from "../editing/batch";
import { getReportCellContext, type ReportCellContext } from "../editing/context";
import { createReportEditSession, getReportEditSession, registerReportEditSession } from "../editing/session";
import { paginateTemplate, type ListComponent, type PaginateOptions, type ReportTemplate } from "../layout/paginate";
import { createLocalSessionReflow } from "../editing/session-reflow";
import type { ReportEditSessionPart } from "../editing/session-data";
import * as validation from "../schema/validate";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const template = createTableTemplate({ layout: "wide", title: "Notes", columns: [
    { field: "id", header: "ID", widthMm: 20 },
    { field: "note", header: "Note", widthMm: 40, style: { fontSize: 13, bold: true, letterSpacing: 0.2, borderLeft: false } }
  ], listOptions: { rowKey: "id", revisionField: "revision", sourceTokenField: "token", rowHeightMm: 8 } });
  const datasets = { detail: [{ id: "001", note: "before", revision: 1, token: "v1" }, { id: "002", note: "other", revision: 1, token: "v1" }] };
  return { template, datasets };
}
function list(template: ReportTemplate): ListComponent { return template.pages[0]!.components.find(component => component.kind === "list") as ListComponent; }
function cell(plan: RenderPlan, rowKey: string | number, field = "note", sourceScope?: string): ReportCellContext {
  for (const [pageIndex, page] of plan.pages.entries()) for (const [componentIndex, component] of page.components.entries()) {
    if (component.table?.role !== "body" || component.table.source?.rowKey !== rowKey || (sourceScope !== undefined && component.table.source.sourceScope !== sourceScope)) continue;
    return getReportCellContext(plan, { pageIndex, componentIndex, rowIndex: 0, columnIndex: component.table.columnKeys.indexOf(field) })!;
  }
  throw new Error("Missing source cell");
}
function edit(plan: RenderPlan, value: string | number = "after", field = "note") {
  return createReportCellEditBatch(plan, [{ address: cell(plan, "001", field).address, value }], "edit");
}
function body(plan: RenderPlan, key = "002"): Readonly<PlanComponent> { return cell(plan, key).component; }

describe("proved local source reflow", () => {
  it("matches complete pagination, preserves source/old plans, validates the candidate and reuses untouched geometry", async () => {
    const input = fixture(), session = createReportEditSession(input), initial = session.plan;
    const check = vi.spyOn(validation, "validateRenderPlan");
    const prepared = await session.prepare(initial, edit(initial));
    const full = paginateTemplate(input.template, { detail: input.datasets.detail.map(row => row.id === "001" ? { ...row, note: "after" } : row) }).plan;
    expect(prepared.plan).toEqual(full);
    expect(body(prepared.plan)).toBe(body(initial));
    expect(cell(prepared.plan, "001").cell.style).toBe(cell(initial, "001").cell.style);
    expect(check).toHaveBeenCalledWith(prepared.plan);
    expect(cell(initial, "001").value).toBe("before"); expect(input.datasets.detail[0]!.note).toBe("before");
    const committed = prepared.commit({ revision: 2, sourceToken: "v2" });
    expect(cell(committed, "002").source).toMatchObject({ revision: 2, sourceToken: "v2" });
    expect(() => prepared.commit()).toThrow("conflict");
    const undo = await session.prepareHistory(committed, edit(initial).edits, "previousValue", "undo");
    const restored = undo.prepared.commit();
    expect(cell(restored, "001").value).toBe("before"); expect(body(restored)).toBe(body(committed));
    const redo = await session.prepareHistory(restored, edit(initial).edits, "value", "redo");
    expect(cell(redo.prepared.commit(), "001").value).toBe("after");
  });

  it("updates every explicit shared-source mirror and isolates unrelated source scopes through createReportSource", async () => {
    const spec = fixture();
    const source = createReportSource({ A: { ...spec, sourceScope: "shared" }, B: { ...spec, sourceScope: "shared" }, C: { ...spec, sourceScope: "isolated" } });
    const plan = await source({ reportIds: ["A", "B", "C"], params: {} });
    const session = getReportEditSession(plan)!;
    const next = (await session.prepare(plan, edit(plan))).commit();
    const mirrors = next.pages.flatMap(page => page.components).filter(component => component.table?.role === "body" && component.table.source?.rowKey === "001");
    expect(mirrors.map(component => component.grid!.cells[0]![1]!.value)).toEqual(["after", "after", "before"]);
    expect(body(next)).toBe(body(plan)); expect(spec.datasets.detail[0]!.note).toBe("before");
  });

  it("retains distinct numeric and textual business keys", async () => {
    const input = fixture();
    const datasets = { detail: [{ id: 1, note: "numeric" }, { id: "1", note: "textual" }] };
    const session = createReportEditSession({ template: input.template, datasets }), plan = session.plan;
    const change = createReportCellEditBatch(plan, [{ address: cell(plan, "1").address, value: "changed" }], "typed-key");
    const next = (await session.prepare(plan, change)).commit();
    expect(cell(next, 1).value).toBe("numeric"); expect(cell(next, "1").value).toBe("changed");
  });

  it("rejects row-key edits, aborted or stale preparations and old-plan mutation while persistence is pending", async () => {
    const session = createReportEditSession(fixture()), initial = session.plan;
    await expect(session.prepare(initial, edit(initial, "other-id", "id"))).rejects.toMatchObject({ code: "readonly" });
    const cancelled = new AbortController(); cancelled.abort();
    await expect(session.prepare(initial, edit(initial), { signal: cancelled.signal })).rejects.toMatchObject({ name: "AbortError" });
    const pending = await session.prepare(initial, edit(initial));
    (body(initial) as PlanComponent).heightMm += 1;
    expect(() => pending.commit()).toThrow("conflict"); expect(session.plan).toBe(initial);
    const retry = await session.prepare(initial, edit(initial));
    expect(body(retry.plan)).not.toBe(body(initial));
    const next = retry.commit();
    expect(cell(next, "001").value).toBe("after");
    expect(() => pending.commit()).toThrow("conflict");
  });

  it("runs full source validation before commit and keeps a failed candidate retryable", async () => {
    const session = createReportEditSession(fixture()), plan = session.plan;
    const prepared = await session.prepare(plan, edit(plan));
    prepared.validate({ rules: [{ id: "reject_after", field: "note", assert: { field: "note", op: "!=", value: "after" }, message: "Change rejected" }] });
    expect(() => prepared.commit()).toThrow(); expect(session.plan).toBe(plan);
    const retry = await session.prepare(plan, edit(plan));
    expect(cell(retry.commit(), "001").value).toBe("after");
  });

  it.each(["computed", "groupBy", "groups", "grandTotal", "tree", "matrix", "detail", "rowVisibleWhen", "headerGrid"] as const)("does not reuse layout with %s", async feature => {
    const input = fixture(), original = list(input.template);
    // Eligibility is checked separately from the feature-specific layout schema.
    const template = structuredClone(input.template);
    (list(template) as unknown as Record<string, unknown>)[feature] = {};
    const plan = paginateTemplate(input.template, input.datasets).plan;
    const local = createLocalSessionReflow(plan, [{ template, datasets: input.datasets }], [undefined]);
    expect(await local.candidate(plan, edit(plan).edits)).toBeNull();
    expect(original.rowKey).toBe("id");
  });

  it.each(["rules", "visibleWhen", "visual", "format"] as const)("does not reuse layout with column %s", async feature => {
    const input = fixture(), plan = paginateTemplate(input.template, input.datasets).plan;
    (list(input.template).columns[1] as unknown as Record<string, unknown>)[feature] = {};
    const local = createLocalSessionReflow(plan, [input], [undefined]);
    expect(await local.candidate(plan, edit(plan).edits)).toBeNull();
  });

  it.each([
    { mmPerRow: 1 }, { knownTotalPages: 2 }, { measurer: { measureMm: () => 1 } }, { formula: { evaluate: () => 1 } }
  ] as PaginateOptions[])("keeps custom pagination on complete reflow", async pagination => {
    const input = fixture(), plan = paginateTemplate(input.template, input.datasets).plan;
    const local = createLocalSessionReflow(plan, [input], [pagination]);
    expect(await local.candidate(plan, edit(plan).edits)).toBeNull();
  });

  it.each(["", "\nnext", "a ".repeat(50)])("fully reflows uncertain values or changed wrapping %j", async value => {
    const input = fixture(), session = createReportEditSession(input), plan = session.plan;
    const change = edit(plan, value);
    const next = (await session.prepare(plan, change)).commit();
    expect(body(next)).not.toBe(body(plan));
    expect(next).toEqual(paginateTemplate(input.template, { detail: input.datasets.detail.map(row => row.id === "001" ? { ...row, note: change.edits[0]!.value } : row) }).plan);
  });

  it("fully reflows typed numeric values and narrow-width measurements", async () => {
    const input = fixture(), datasets = { detail: [{ id: "001", note: 1 }, { id: "002", note: 2 }] };
    const session = createReportEditSession({ template: input.template, datasets }), plan = session.plan;
    const next = (await session.prepare(plan, edit(plan, 3))).commit();
    expect(body(next)).not.toBe(body(plan)); expect(cell(next, "001").value).toBe(3);
    list(input.template).columns[1]!.widthMm = 1;
    const narrow = createReportEditSession(input), narrowPlan = narrow.plan;
    const narrowNext = (await narrow.prepare(narrowPlan, edit(narrowPlan))).commit();
    expect(body(narrowNext)).not.toBe(body(narrowPlan));
  });

  it("falls back for dependency-bound furniture, flow, repeat and static grids", async () => {
    for (const customize of [
      (template: ReportTemplate) => { (template.pages[0]!.components[0] as PlanComponent).binding = { field: "note" }; },
      (template: ReportTemplate) => { (template.pages[0]!.components[0] as PlanComponent).chartBinding = {} as PlanComponent["chartBinding"]; },
      (template: ReportTemplate) => { template.pages[0]!.flow = { bands: [] }; },
      (template: ReportTemplate) => { template.repeat = { dataset: "detail" }; },
      (template: ReportTemplate) => { (template.pages[0]!.components[0] as PlanComponent).grid = { cells: [[{ text: "bound", source: { datasetId: "detail", rowKey: "001", field: "note" } }]] }; }
    ]) {
      const input = fixture(), plan = paginateTemplate(input.template, input.datasets).plan;
      customize(input.template);
      expect(await createLocalSessionReflow(plan, [input], [undefined]).candidate(plan, edit(plan).edits)).toBeNull();
    }
  });

  it.each(["source", "richParagraphs", "children", "rowSpan", "colSpan"] as const)("avoids interpreting a %s cell as an ordinary list value", async feature => {
    const input = fixture(), plan = paginateTemplate(input.template, input.datasets).plan;
    const target = cell(plan, "001");
    Object.assign(target.cell, { [feature]: feature.endsWith("Span") ? 2 : feature === "source" ? target.source : [] });
    const local = createLocalSessionReflow(plan, [input], [undefined]);
    expect(await local.candidate(plan, edit(plan).edits)).toBeNull();
  });

  it("falls back when another row overrides its source to mirror the edited field", async () => {
    const input = fixture(), plan = paginateTemplate(input.template, input.datasets).plan;
    Object.assign(cell(plan, "002").cell, { source: cell(plan, "001").source });
    const local = createLocalSessionReflow(plan, [input], [undefined]);
    expect(await local.candidate(plan, edit(plan).edits)).toBeNull();
  });

  it("uses full pagination when plan validation or its exact mutation fence cannot establish a candidate", async () => {
    const input = fixture(), plan = paginateTemplate(input.template, input.datasets).plan;
    const local = createLocalSessionReflow(plan, [input], [undefined]);
    const invalid = vi.spyOn(validation, "validateRenderPlan").mockReturnValue({ ok: false, errors: [], warnings: [] });
    expect(await local.candidate(plan, edit(plan).edits)).toBeNull(); invalid.mockRestore();
    Object.defineProperty(plan, Symbol("host metadata"), { value: 1 });
    expect(await local.candidate(plan, edit(plan).edits)).toBeNull();
    expect(await createLocalSessionReflow(plan, [input], [undefined]).candidate(plan, edit(plan).edits)).toBeNull();
  });

  it("keeps custom public registrations on their explicit rebuild callback", async () => {
    const input = fixture(), plan = paginateTemplate(input.template, input.datasets).plan;
    const rebuild = vi.fn(async (parts: readonly ReportEditSessionPart[]) => paginateTemplate(parts[0]!.template, parts[0]!.datasets).plan);
    const session = registerReportEditSession(plan, { parts: [input], rebuild });
    await session.prepare(plan, edit(plan));
    expect(rebuild).toHaveBeenCalledTimes(1);
  });
});
