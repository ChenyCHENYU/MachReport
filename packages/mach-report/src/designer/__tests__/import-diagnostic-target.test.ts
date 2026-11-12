import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, expect, it } from "vitest";
import type { ExcelImportDiagnostic, ExcelImportResult } from "../../xlsx/import-types";
import { RENDER_PLAN_SCHEMA_VERSION } from "../../index";
import ExcelImportDiagnostics from "../ExcelImportDiagnostics.vue";
import { importDiagnosticTarget } from "../import-diagnostic-target";

const cleanup: VueWrapper[] = [];
afterEach(() => cleanup.splice(0).forEach(wrapper => wrapper.unmount()));
function source(): ExcelImportResult {
  return { template: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages: [] }, warnings: [], sheets: [
    { name: "生产", index: 1, range: "C10:Z100", rowCount: 91, columnCount: 24, pageStart: 0, pageCount: 1 },
    { name: "汇总", index: 2, range: "A1:B20", rowCount: 20, columnCount: 2, pageStart: 1, pageCount: 1 },
  ] };
}
const issue = (location: Partial<ExcelImportDiagnostic> = {}): ExcelImportDiagnostic => ({ code: "formula-cached", severity: "warning", message: "Unrelated to location A1", sheet: "生产", ...location });
it("resolves only structured coordinates and rejects unknown, malformed or out-of-import locations", () => {
  const imported = source();
  expect(importDiagnosticTarget(issue({ cell: "Z100" }), imported)).toEqual({ sheet: "生产", row: 100, column: 26 });
  expect(importDiagnosticTarget(issue({ range: "D20:F22" }), imported)).toEqual({ sheet: "生产", row: 20, column: 4 });
  expect(importDiagnosticTarget(issue({ row: 40 }), imported)).toEqual({ sheet: "生产", row: 40, column: 3 });
  expect(importDiagnosticTarget(issue({ cell: "A1" }), imported)).toBeUndefined();
  expect(importDiagnosticTarget(issue({ sheet: "unknown", cell: "A1" }), imported)).toBeUndefined();
  expect(importDiagnosticTarget(issue({ row: Infinity }), imported)).toBeUndefined();
  expect(importDiagnosticTarget(issue({ range: "invalid" }), imported)).toBeUndefined();
  expect(importDiagnosticTarget(issue({ sheet: undefined, part: "xl/charts/chart1.xml" }), imported)).toBeUndefined();
});
it("bounds detail rows while preserving occurrence totals, source positions and read-only navigation", async () => {
  const imported = source(), entries = Array.from({ length: 200 }, (_, index) => issue({ row: 10 + index % 91, column: 3 }));
  imported.diagnostics = entries;
  imported.diagnosticSummary = { total: 10000, counts: { formula: 10000 }, entries, omitted: 9800 };
  const wrapper = mount(ExcelImportDiagnostics, { props: { source: imported, currentSheet: "生产", disabled: true } });
  cleanup.push(wrapper);
  expect(wrapper.get("summary").text()).toContain("10000");
  expect(wrapper.get("summary").text()).toContain("200 / 10000");
  expect(wrapper.findAll("li")).toHaveLength(12);
  await wrapper.get("li button").trigger("click");
  expect(wrapper.emitted("locate")?.[0]).toEqual([{ sheet: "生产", row: 10, column: 3 }]);
  await wrapper.get('[aria-label="下一组问题"]').trigger("click");
  await wrapper.get("li button").trigger("click");
  expect(wrapper.emitted("locate")?.at(-1)).toEqual([{ sheet: "生产", row: 22, column: 3 }]);
  imported.diagnostics = [issue({ sheet: "汇总", cell: "A1" }), issue({ sheet: undefined, part: "xl/charts/chart1.xml" })];
  delete imported.diagnosticSummary;
  await wrapper.setProps({ source: { ...imported } });
  expect(wrapper.find("li button").exists()).toBe(false);
  expect(wrapper.text()).toContain("xl/charts/chart1.xml");
  await wrapper.setProps({ disabled: false });
  await wrapper.get("li button").trigger("click");
  expect(wrapper.emitted("locate")?.at(-1)).toEqual([{ sheet: "汇总", row: 1, column: 1 }]);
});
