// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate } from "../builder/table-template";
import { createReportSource } from "../source/report-source";
import { createReportCellEditBatch, type ReportEditBatch } from "../editing/batch";
import { getReportCellContext, type ReportCellContext } from "../editing/context";
import { createReportEditSession, getReportEditSession } from "../editing/session";
import { relocateReportCellEdits } from "../editing/session-context";
import type { RenderPlan } from "../schema/render-plan";

function fixture() {
  const template = createTableTemplate({ layout: "wide", columns: [
    { field: "id", header: "ID" }, { field: "qty", header: "Qty", valueType: "number" }, { field: "price", header: "Price" },
    { field: "amount", header: "Amount", rules: [{ when: { field: "amount", op: ">", value: 10 }, style: { color: "#ff0000" } }] }
  ], listOptions: { rowKey: "id", revisionField: "rev", sourceTokenField: "token", rowVisibleWhen: { field: "qty", op: ">", value: 0 }, computed: [{ field: "amount", expression: { op: "multiply", args: [{ field: "qty" }, { field: "price" }] } }], grandTotal: { fields: ["amount"] } } });
  const datasets = { detail: [{ id: "001", qty: 2, price: 3, rev: "1", token: "v1" }, { id: "002", qty: 3, price: 4, rev: "1", token: "v1" }] };
  return { template, datasets };
}
function cell(plan: RenderPlan, id: string, field: string): ReportCellContext {
  for (const [pageIndex, page] of plan.pages.entries()) for (const [componentIndex, component] of page.components.entries()) {
    if (component.table?.role !== "body" || component.table.source?.rowKey !== id) continue;
    const columnIndex = component.table.columnKeys.indexOf(field);
    return getReportCellContext(plan, { pageIndex, componentIndex, rowIndex: 0, columnIndex })!;
  }
  throw new Error(`No visible cell ${id}.${field}`);
}
function batch(plan: RenderPlan, id: string, qty: number, requestId = "edit-1"): ReportEditBatch {
  return createReportCellEditBatch(plan, [{ address: cell(plan, id, "qty").address, value: qty }], requestId);
}

describe("template-owned edit/recalculate transactions", () => {
  it("prepares calculation, conditions, totals and reflow before commit without mutating source objects", async () => {
    const original = fixture(), session = createReportEditSession(original), initial = session.plan;
    const edit = batch(initial, "001", 5);
    const prepared = await session.prepare(initial, edit);
    expect(cell(prepared.plan, "001", "amount").value).toBe(15);
    expect(cell(prepared.plan, "001", "amount").cell.style?.color).toBe("#ff0000");
    expect(prepared.plan.pages.flatMap((page) => page.components).find((component) => component.table?.role === "grand-total")!.grid!.cells[0]!.at(-1)?.value).toBe(27);
    expect(cell(initial, "001", "qty").value).toBe(2); expect(session.plan).toBe(initial); expect(original.datasets.detail[0]!.qty).toBe(2);
    const committed = prepared.commit({ revision: "2", sourceToken: "v2" });
    expect(getReportEditSession(committed)).toBe(session);
    expect(cell(committed, "001", "qty").source).toMatchObject({ revision: "2", sourceToken: "v2" });
    expect(cell(committed, "002", "qty").source).toMatchObject({ revision: "2", sourceToken: "v2" });
    expect(() => prepared.commit()).toThrow("conflict");
    original.datasets.detail[1]!.price = 999; original.template.pages[0]!.components = [];
    const second = await session.prepare(committed, batch(committed, "002", 4));
    expect(cell(second.plan, "002", "amount").value).toBe(16);
    expect(cell(second.plan, "001", "qty").source).toMatchObject({ revision: "2", sourceToken: "v2" });
  });

  it("rejects external in-place source or template mutations before the first transaction", async () => {
    const first = fixture(), session = createReportEditSession(first), edit = batch(session.plan, "001", 5);
    first.datasets.detail[1]!.price = 999;
    await expect(session.prepare(session.plan, edit)).rejects.toMatchObject({ code: "conflict" });
    const other = fixture(), otherSession = createReportEditSession(other), otherEdit = batch(otherSession.plan, "001", 5);
    other.template.pages[0]!.heightMm++;
    await expect(otherSession.prepare(otherSession.plan, otherEdit)).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps failed and superseded transactions isolated and respects cancellation", async () => {
    const session = createReportEditSession(fixture()), initial = session.plan;
    const stale = await session.prepare(initial, batch(initial, "001", 5));
    const current = await session.prepare(initial, batch(initial, "001", 6));
    const committed = current.commit();
    expect(() => stale.commit()).toThrow("conflict"); expect(cell(committed, "001", "amount").value).toBe(18);
    await expect(session.prepare(initial, batch(initial, "002", 7))).rejects.toMatchObject({ code: "conflict" });
    const controller = new AbortController(); controller.abort();
    await expect(session.prepare(committed, batch(committed, "002", 7), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(session.plan).toBe(committed);
  });

  it("undoes a row hidden by an edit using its retained business identity, then redoes it", async () => {
    const session = createReportEditSession(fixture()), initial = session.plan;
    const edit = batch(initial, "001", 0);
    const hidden = (await session.prepare(initial, edit)).commit({ revision: "2", sourceToken: "v2" });
    expect(() => cell(hidden, "001", "qty")).toThrow("No visible");
    expect(() => relocateReportCellEdits(hidden, edit.edits, "previousValue")).toThrow("missing");
    const undo = await session.prepareHistory(hidden, edit.edits, "previousValue", "undo-1");
    expect(undo.contexts[0]!.value).toBe(0); expect(undo.contexts[0]!.source).toMatchObject({ datasetId: "detail", rowKey: "001", field: "qty", revision: "2", sourceToken: "v2" });
    expect(undo.batch.edits[0]).toMatchObject({ previousValue: 0, value: 2 });
    const restored = undo.prepared.commit({ revision: "3", sourceToken: "v3" });
    expect(cell(restored, "001", "amount").value).toBe(6);
    const redo = await session.prepareHistory(restored, edit.edits, "value", "redo-1");
    expect(redo.batch.edits[0]!.source).toMatchObject({ revision: "3", sourceToken: "v3" });
    const rehidden = redo.prepared.commit(); expect(() => cell(rehidden, "001", "qty")).toThrow("No visible");
  });

  it("automatically binds template sources, supports mirrored reports and preserves aggregate limits", async () => {
    const spec = fixture();
    const source = createReportSource({ A: spec, B: spec }, { maxPages: 10, maxCells: 100 });
    const plan = await source({ reportIds: ["A", "B"], params: {} });
    const session = getReportEditSession(plan)!; expect(session).toBeDefined();
    const next = (await session.prepare(plan, batch(plan, "001", 5))).commit();
    const values = next.pages.flatMap((page) => page.components).filter((component) => component.table?.source?.rowKey === "001").map((component) => component.grid!.cells[0]![3]!.value);
    expect(values).toEqual([15, 15]); expect(new Set(next.pages.flatMap((page) => page.components).map((component) => component.table?.id)).size).toBe(2);
  });

  it("relocates visible history after other rows disappear and refreshes hidden-row tokens", async () => {
    const session = createReportEditSession(fixture()), initial = session.plan;
    const secondEdit = batch(initial, "002", 4);
    const secondChanged = (await session.prepare(initial, secondEdit)).commit({ revision: "2", sourceToken: "v2" });
    const hideEdit = batch(secondChanged, "001", 0);
    const hidden = (await session.prepare(secondChanged, hideEdit)).commit({ revision: "3", sourceToken: "v3" });
    const relocated = relocateReportCellEdits(hidden, secondEdit.edits, "previousValue");
    expect(relocated[0]!.address.componentIndex).not.toBe(secondEdit.edits[0]!.address.componentIndex);
    const secondUndo = await session.prepareHistory(hidden, secondEdit.edits, "previousValue", "undo-second");
    const onlySecondRestored = secondUndo.prepared.commit({ revision: "4", sourceToken: "v4" });
    expect(cell(onlySecondRestored, "002", "qty").value).toBe(3);
    const firstUndo = await session.prepareHistory(onlySecondRestored, hideEdit.edits, "previousValue", "undo-first");
    expect(firstUndo.contexts[0]!.source).toMatchObject({ revision: "4", sourceToken: "v4" });
    expect(cell(firstUndo.prepared.commit(), "001", "qty").value).toBe(2);
  });

  it("yields across real page slices and cancels without committing a partial reflow", async () => {
    const spec = fixture();
    const list = spec.template.pages[0]!.components.find((component) => component.kind === "list")!;
    if (list.kind !== "list") throw new Error("fixture");
    list.rowHeightMm = 20;
    spec.datasets.detail = Array.from({ length: 250 }, (_, index) => ({ id: String(index).padStart(3, "0"), qty: 2, price: 3, rev: "1", token: "v1" }));
    const session = createReportEditSession(spec), initial = session.plan, controller = new AbortController();
    const pending = session.prepare(initial, batch(initial, "001", 5), { signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 0);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    clearTimeout(timer); expect(session.plan).toBe(initial); expect(cell(initial, "001", "qty").value).toBe(2);
  });

  it("preserves required-recalculation metadata across JSON transport without claiming a session", async () => {
    const spec = fixture(), plan = await createReportSource({ A: spec })({ reportIds: ["A"], params: {} });
    expect(plan.requiresRecalculation).toBe(true);
    const transported: RenderPlan = JSON.parse(JSON.stringify(plan));
    expect(transported.requiresRecalculation).toBe(true); expect(getReportEditSession(transported)).toBeUndefined();
    expect(cell(transported, "001", "amount").editable).toBe(false); expect(cell(transported, "001", "amount").source).toBeUndefined();
  });

  it("keeps master and child concurrency contracts independent during a child edit", async () => {
    const template = createTableTemplate({ dataset: "masters", columns: [{ field: "id", header: "ID" }, { field: "qty", header: "Qty" }], listOptions: {
      rowKey: "id", revisionField: "rev", sourceTokenField: "token", detail: { dataset: "lines", parentKey: "id", foreignKey: "masterId", rowKey: "lineId", revisionField: "lineRev", sourceTokenField: "lineToken", unmatched: "ignore", columns: [{ field: "lineId", header: "Line", widthMm: 30 }, { field: "qty", header: "Qty", widthMm: 30 }] }
    } });
    const datasets = { masters: [{ id: "M1", qty: 1, rev: "parent-1", token: "parent-token" }], lines: [{ lineId: "L1", masterId: "M1", qty: 2, lineRev: "line-1", lineToken: "line-token" }, { lineId: "L1", masterId: "ignored", qty: 999, lineRev: "other", lineToken: "other" }] };
    const source = createReportSource({ A: { template, datasets } }), plan = await source({ reportIds: ["A"], params: {} }), session = getReportEditSession(plan)!;
    const edit = batch(plan, "L1", 5), next = (await session.prepare(plan, edit)).commit({ revision: "line-2", sourceToken: "line-token-2" });
    expect(cell(next, "L1", "qty").value).toBe(5); expect(cell(next, "L1", "qty").source).toMatchObject({ datasetId: "lines", revision: "line-2", sourceToken: "line-token-2" });
    expect(cell(next, "M1", "qty").source).toMatchObject({ datasetId: "masters", revision: "parent-1", sourceToken: "parent-token" });
    const after = (await session.prepare(next, batch(next, "L1", 6))).commit();
    expect(cell(after, "L1", "qty").source).toMatchObject({ revision: "line-2", sourceToken: "line-token-2" });
    expect(datasets.lines[0]!.qty).toBe(2);
  });

  it("refreshes total-page anchors rather than reusing a query's old knownTotalPages", async () => {
    const template = { pages: [{ widthMm: 100, heightMm: 40, components: [
      { kind: "list" as const, dataset: "rows", rowKey: "id", leftMm: 0, topMm: 0, widthMm: 100, rowHeightMm: 10, rowVisibleWhen: { field: "qty", op: ">" as const, value: 0 }, columns: [{ field: "id", header: "ID", widthMm: 50 }, { field: "qty", header: "Qty", widthMm: 50 }] },
      { kind: "text" as const, leftMm: 0, topMm: 37, widthMm: 100, heightMm: 3, pageAnchor: "footer" as const, text: "{page}/{totalPages}" }
    ] }] };
    const datasets = { rows: Array.from({ length: 8 }, (_, index) => ({ id: String(index), qty: 1 })) };
    const session = createReportEditSession({ template, datasets, pagination: { knownTotalPages: 4 } }), initial = session.plan;
    expect(initial.pages).toHaveLength(4);
    const edits = createReportCellEditBatch(initial, ["0", "1", "2"].map((id) => ({ address: cell(initial, id, "qty").address, value: 0 })), "hide-three");
    const updated = (await session.prepare(initial, edits)).commit(); expect(updated.pages).toHaveLength(3);
    expect(updated.pages.flatMap((page) => page.components).filter((component) => component.pageAnchor === "footer").map((component) => component.text)).toEqual(["1/3", "2/3", "3/3"]);
  });

  it("pairs history contexts with non-noop edits and locks the prepared batch before caller mutation", async () => {
    const session = createReportEditSession(fixture()), initial = session.plan;
    const pasted = createReportCellEditBatch(initial, [{ address: cell(initial, "001", "qty").address, value: 5 }, { address: cell(initial, "002", "qty").address, value: 4 }], "paste");
    const changed = (await session.prepare(initial, pasted)).commit();
    const firstRestored = (await session.prepare(changed, batch(changed, "001", 2))).commit();
    const history = await session.prepareHistory(firstRestored, pasted.edits, "previousValue", "restore");
    expect(history.batch.edits).toHaveLength(1); expect(history.contexts).toHaveLength(1);
    expect(history.batch.edits[0]!.source?.rowKey).toBe("002"); expect(history.contexts[0]!.source?.rowKey).toBe("002");
    // A host can filter or detach the persistence payload; prepared state remains aligned.
    history.batch.edits = history.batch.edits.filter((edit) => !Object.is(edit.previousValue, edit.value));
    history.batch.edits[0]!.value = 999;
    const restored = history.prepared.commit();
    expect(cell(restored, "001", "qty").value).toBe(2); expect(cell(restored, "002", "qty").value).toBe(3);
    // Retained contexts are also correct when the next history operation hides/restores this row.
    const hidden = (await session.prepare(restored, batch(restored, "002", 0))).commit();
    const redo = await session.prepareHistory(hidden, pasted.edits.slice(1), "value", "redo");
    expect(redo.contexts[0]!.value).toBe(0); expect(redo.batch.edits[0]!.value).toBe(4);
  });

  it("never trusts custom toJSON or getters to hide source mutations in the first snapshot", async () => {
    const spec = fixture();
    const row = spec.datasets.detail[0]!;
    Object.defineProperty(row, "toJSON", { enumerable: true, value: () => ({ id: "001", qty: 2, price: 3 }) });
    expect(() => createReportEditSession(spec)).toThrow("conflict");
    const warnings: string[] = [];
    const sourcePlan = await createReportSource({ A: spec }, { onWarning: (message) => warnings.push(message) })({ reportIds: ["A"], params: {} });
    expect(sourcePlan.requiresRecalculation).toBe(true); expect(getReportEditSession(sourcePlan)).toBeUndefined(); expect(warnings).toHaveLength(1);
    const nonEnumerable = fixture();
    Object.defineProperty(nonEnumerable.datasets.detail[0], "toJSON", { enumerable: false, value: () => ({ qty: 2 }) });
    expect(() => createReportEditSession(nonEnumerable)).toThrow("conflict");
    const accessor = fixture();
    Object.defineProperty(accessor.datasets.detail[0], "hiddenGetter", { enumerable: true, get: () => "untrusted" });
    expect(() => createReportEditSession(accessor)).toThrow("conflict");
  });

  it("rejects attempts to change stable source keys or fabricated computed outputs", async () => {
    const session = createReportEditSession(fixture()), plan = session.plan;
    const keyEdit = createReportCellEditBatch(plan, [{ address: cell(plan, "001", "id").address, value: "new-key" }], "key");
    await expect(session.prepare(plan, keyEdit)).rejects.toMatchObject({ code: "readonly" });
    const qty = batch(plan, "001", 5); qty.edits[0]!.source = { ...qty.edits[0]!.source!, field: "amount" };
    await expect(session.prepare(plan, qty)).rejects.toMatchObject({ code: "conflict" });
    expect(session.plan).toBe(plan);
  });
});
