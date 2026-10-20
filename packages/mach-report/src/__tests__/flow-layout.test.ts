// @vitest-environment node
import { describe, expect, it } from "vitest";
import { paginateTemplate, paginateTemplatePages, type ListComponent, type ReportTemplate } from "../layout/paginate";
const list: ListComponent = { kind: "list", id: "rows", dataset: "rows", leftMm: 0, topMm: 30, widthMm: 80, rowHeightMm: 8, paddingMm: 0, columns: [{ field: "a", header: "A", widthMm: 80 }] };
function template(component = list): ReportTemplate { return { pages: [{ widthMm: 100, heightMm: 65, marginTopMm: 5, marginBottomMm: 5, components: [component, { kind: "text", nid: "tail", leftMm: 0, topMm: 40, widthMm: 80, heightMm: 5, text: "tail" }], flow: { bands: [{ componentIds: ["rows"], topMm: 30, heightMm: 8 }, { componentIds: ["tail"], topMm: 40, heightMm: 5 }] } }] }; }
describe("explicit vertical flow", () => {
  it("continues after the last fragment on a fresh page, preserving the original gap", () => {
    const source = template(), data = { rows: Array.from({ length: 7 }, (_, index) => ({ a: index })) };
    const { plan } = paginateTemplate(source, data);
    expect(plan.pages.length).toBeGreaterThan(1);
    const last = plan.pages.at(-1)!, tail = last.components.find(component => component.nid === "tail")!;
    const lastRow = last.components.filter(component => component.table?.role === "body").at(-1)!;
    expect(tail.topMm).toBeCloseTo(lastRow.topMm + lastRow.heightMm + 2);
    expect([...paginateTemplatePages(source, data)]).toEqual(plan.pages);
  });
  it("record regions render empty placeholders without inventing a business row and reject truncation", () => {
    const record: ListComponent = { ...list, header: false, cardinality: "record", rowKey: "id", columns: list.columns.map(column => ({ ...column, editable: true })) };
    const source = template(record), plan = paginateTemplate(source, { rows: [] }).plan;
    const fragments = plan.pages[0]!.components.filter(component => component.table);
    expect(fragments).toHaveLength(1); expect(fragments[0]!.table?.role).toBe("body");
    expect(fragments[0]!.table?.source).toBeUndefined(); expect(fragments[0]!.grid?.cells[0]?.[0]?.text).toBe("");
    expect(fragments[0]!.grid?.cells[0]?.[0]?.editable).toBe(false);
    expect(() => paginateTemplate(source, { rows: [{ id: 1 }, { id: 2 }] })).toThrow("仅允许");
  });
  it("rejects an overheight empty header and honors cancellation between static pages", () => {
    const hugeHeader: ListComponent = { ...list, headerGrid: { cells: [[{ text: "A" }]], rowHeightsMm: [80], colWidthsMm: [80] } };
    expect(() => paginateTemplate(template(hugeHeader), { rows: [] })).toThrow("表头高度");
    const staticTemplate: ReportTemplate = { pages: [{ widthMm: 100, heightMm: 40, marginTopMm: 5, marginBottomMm: 5,
      components: [{ kind: "text", nid: "a", leftMm: 0, topMm: 5, widthMm: 80, heightMm: 20, text: "A" }, { kind: "text", nid: "b", leftMm: 0, topMm: 25, widthMm: 80, heightMm: 20, text: "B" }],
      flow: { bands: [{ componentIds: ["a"], topMm: 5, heightMm: 20 }, { componentIds: ["b"], topMm: 25, heightMm: 20 }] }
    }] };
    const controller = new AbortController(), pages = paginateTemplatePages(staticTemplate, {}, { signal: controller.signal });
    expect(pages.next().done).toBe(false); controller.abort();
    expect(() => pages.next()).toThrow("取消");
  });
  it("rejects impossible bands and overlapping structures before returning an invalid preview", () => {
    const source = template(); source.pages[0]!.flow!.bands[1]!.topMm = 31;
    expect(() => paginateTemplate(source, { rows: [] })).toThrow("重叠");
    const tooTall = template(); tooTall.pages[0]!.flow!.bands[1]!.heightMm = 60;
    expect(() => paginateTemplate(tooTall, { rows: [] })).toThrow("单页");
  });
});
