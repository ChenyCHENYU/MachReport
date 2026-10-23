// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createReportDrillRequest, matchReportDrillActions, resolveReportDrillReturn, validateReportDrillActions, type ReportDrillAction } from "../source/drill";
import { createReportSource } from "../source/report-source";
import { createTableTemplate } from "../builder/table-template";

async function fixture() {
  const template = createTableTemplate({ columns: [{ field: "heat", header: "Heat" }, { field: "qty", header: "Qty" }], listOptions: { rowKey: "id" } });
  const plan = await createReportSource({ report: { template, datasets: { detail: [{ id: "001", heat: "22W418", qty: 0 }] } } })({ reportIds: ["report"], params: {} });
  const componentIndex = plan.pages[0]!.components.findIndex(component => component.table?.role === "body");
  const address = { pageIndex: 0, componentIndex, rowIndex: 0, columnIndex: 1 };
  const action: ReportDrillAction = { id: "heat-detail", label: "炉次实绩", target: { datasetId: "detail", field: "qty", roles: ["body"] }, params: {
    heat: { from: "field", field: "heat" }, quantity: { from: "value" }, plant: { from: "query", field: "plant" }, id: { from: "rowKey" }, enabled: { value: false }
  } };
  return { plan, address, action };
}
describe("declarative drill-through", () => {
  it("binds only declared scalar parameters, preserves zeros and leading-zero IDs and snapshots return state", async () => {
    const { plan, address, action } = await fixture(), params = { plant: "YTS0" };
    expect(matchReportDrillActions(plan, address, [action])).toEqual([action]);
    const request = createReportDrillRequest(plan, address, action, params);
    params.plant = "OTHER"; address.columnIndex = 0;
    expect(request.params).toEqual({ heat: "22W418", quantity: "0", plant: "YTS0", id: "001", enabled: "false" });
    expect(request.returnState).toMatchObject({ params: { plant: "YTS0" }, address: { columnIndex: 1 }, reportScope: '[0,"report"]' });
    expect(Object.isFrozen(request.params)).toBe(true);
  });
  it("rejects missing/hidden values and unrelated targets instead of guessing a business route", async () => {
    const { plan, address, action } = await fixture();
    expect(() => createReportDrillRequest(plan, address, action)).toThrow("missing-value");
    expect(() => createReportDrillRequest(plan, { ...address, columnIndex: 0 }, action)).toThrow("target");
    action.params = { secret: { from: "field", field: "not-in-plan" } };
    expect(() => createReportDrillRequest(plan, address, action)).toThrow("missing-value");
    action.target.reportScope = "another";
    expect(matchReportDrillActions(plan, address, [action])).toEqual([]);
  });
  it("rejects executable/prototype bindings, duplicate actions, excessive count and nonfinite scalars", async () => {
    const { action } = await fixture();
    for (const params of [JSON.parse('{"__proto__":{"value":"x"}}'), { x: { from: "script", code: "alert(1)" } }, { x: { value: Infinity } }, { x: { value: {} } }]) {
      expect(() => validateReportDrillActions([{ ...action, params }])).toThrow("config");
    }
    expect(() => validateReportDrillActions([action, action])).toThrow("config");
    expect(() => validateReportDrillActions(Array(65).fill(action))).toThrow("config");
  });
  it("handles arbitrary persisted action shapes deterministically without executing them", () => {
    let seed = 17;
    const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    for (let index = 0; index < 250; index++) {
      const value = [null, [], {}, { id: "x" }, { id: "x", label: "x", target: { field: "x" }, params: { p: { from: String(next()) } } }][next() % 5];
      expect(() => validateReportDrillActions([value] as ReportDrillAction[])).toThrow("config");
    }
  });
  it("returns to the original business row after reordering and never lands on a replacement row", async () => {
    const { plan, address, action } = await fixture();
    const request = createReportDrillRequest(plan, address, action, { plant: "YTS0" });
    const original = plan.pages[0]!.components[address.componentIndex]!;
    const inserted = { ...original, table: { ...original.table!, source: { ...original.table!.source!, rowKey: "002" } } };
    const shifted = { ...plan, pages: [{ ...plan.pages[0]!, components: [inserted, ...plan.pages[0]!.components] }] };
    expect(resolveReportDrillReturn(shifted, request.returnState)).toEqual({ ...address, componentIndex: address.componentIndex + 1 });
    expect(resolveReportDrillReturn({ ...shifted, pages: [{ ...shifted.pages[0]!, components: [inserted] }] }, request.returnState)).toBeNull();
    expect(request.returnState.source).toEqual({ sourceScope: '[0,"report"]', datasetId: "detail", rowKey: "001", field: "qty" });
    expect(request.returnState.source).not.toHaveProperty("sourceToken");
  });
});
