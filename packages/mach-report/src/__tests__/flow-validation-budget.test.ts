// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PlanComponent } from "../schema/render-plan";
import type { ReportPageFlow } from "../layout/flow";
import { reportFlowGroups, validateReportPageFlow } from "../layout/flow";
import { paginateTemplate, type ReportTemplate } from "../layout/paginate";

function manyRegions(count: number) {
  let reads = 0;
  const components: PlanComponent[] = Array.from({ length: count }, (_, index) => ({
    kind: "text", get nid() { reads++; return `region-${index}`; },
    leftMm: 0, topMm: index * 5, widthMm: 80, heightMm: 4, text: `Region ${index}`
  }));
  const flow: ReportPageFlow = { bands: components.map((_, index) => ({ componentIds: [`region-${index}`], topMm: index * 5, heightMm: 4 })) };
  return { components, flow, reads: () => reads };
}

describe("flow region validation work", () => {
  it("resolves each component once instead of scanning the entire page for each band", () => {
    const { components, flow, reads } = manyRegions(1000);
    validateReportPageFlow(components, flow);
    expect(reads()).toBeLessThanOrEqual(components.length * 2);
    const groups = reportFlowGroups(components, flow);
    expect(groups).toHaveLength(1000);
    groups.forEach((group, index) => {
      expect(group.band).toBe(flow.bands[index]);
      expect(group.components).toEqual([components[index]]);
    });
  });

  it("preserves declared within-band order and permits opaque special-character ids", () => {
    const components: PlanComponent[] = ["__proto__", "constructor", "a:b"].map((nid, index) => ({ kind: "text", nid, leftMm: index * 20, topMm: 0, widthMm: 20, heightMm: 4, text: nid }));
    const flow = { bands: [{ componentIds: ["constructor", "__proto__", "a:b"], topMm: 0, heightMm: 4 }] };
    validateReportPageFlow(components, flow);
    expect(reportFlowGroups(components, flow)[0]!.components).toEqual([components[1], components[0], components[2]]);
  });

  it("rejects missing/duplicate/anchored ids and out-of-band geometry before layout", () => {
    for (const change of [
      (value: ReturnType<typeof manyRegions>) => { value.flow.bands[1]!.componentIds = ["missing"]; },
      (value: ReturnType<typeof manyRegions>) => { value.flow.bands[1]!.componentIds = ["region-0"]; },
      (value: ReturnType<typeof manyRegions>) => { value.components[0]!.pageAnchor = "header"; },
      (value: ReturnType<typeof manyRegions>) => { value.components[0]!.heightMm = 10; },
      (value: ReturnType<typeof manyRegions>) => { value.flow.bands.pop(); },
    ]) {
      const value = manyRegions(3); change(value);
      expect(() => validateReportPageFlow(value.components, value.flow)).toThrow();
    }
  });

  it("keeps page anchors from replacing an equally named body region", () => {
    const body: PlanComponent = { kind: "text", nid: "shared", leftMm: 0, topMm: 10, widthMm: 80, heightMm: 5, text: "Actual detail" };
    const header: PlanComponent = { ...body, topMm: 0, text: "Page header", pageAnchor: "header" };
    const source: ReportTemplate = { pages: [{ widthMm: 100, heightMm: 60, components: [body, header], flow: { bands: [{ componentIds: ["shared"], topMm: 10, heightMm: 5 }] } }] };
    const page = paginateTemplate(source, {}).plan.pages[0]!;
    expect(page.components.filter(component => component.text === "Actual detail")).toHaveLength(1);
    expect(page.components.filter(component => component.text === "Page header")).toHaveLength(1);
    expect(page.components.find(component => component.text === "Actual detail")!.topMm).toBe(10);
  });
});
