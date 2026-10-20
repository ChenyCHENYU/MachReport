// @vitest-environment node
import { describe, expect, it } from "vitest";
import { platformTemplate, platformDatasets } from "../../../examples/minimal/src/platform-template";
import { paginateTemplate } from "../src/layout/paginate";
import { validateReportTemplate } from "../src/source/template-registry";
import { createReportSource } from "../src/source/report-source";
describe("production record plus hierarchical cost product fixture", () => {
  it("validates the actual demo, keeps precision/zero/null, and pushes notes after the complete cost region", async () => {
    expect(validateReportTemplate(platformTemplate.template)).toMatchObject({ ok: true, errors: [] });
    const plan = await createReportSource({ operations: { template: platformTemplate.template, datasets: platformDatasets } })({ reportIds: ["operations"], params: {} });
    const components = plan.pages.flatMap(page => page.components), bodies = components.filter(component => component.table?.role === "body");
    expect(bodies.find(component => component.table?.source?.rowKey === "raw")!.grid!.cells[0]![1]!.value).toBe("1234567890143456.20");
    expect(bodies.find(component => component.table?.source?.rowKey === "steel")!.grid!.cells[0]![1]!.text).toBe("1,234,567,890,123,456.12");
    const production = bodies.find(component => component.table?.source?.rowKey === "p1")!;
    expect(production.grid!.cells[0]!.map(cell => cell!.value)).toEqual(["YTS0", "1284.225", 0, null]);
    const total = components.find(component => component.table?.role === "grand-total")!, note = components.find(component => component.nid === "note")!;
    expect(total.grid!.cells[0]![1]!.value).toBe("1234567890180256.20");
    expect(note.topMm).toBeGreaterThanOrEqual(total.topMm + total.heightMm);
    expect(paginateTemplate(platformTemplate.template, platformDatasets).plan.pages).toHaveLength(1);
  });
});
