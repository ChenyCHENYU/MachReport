// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTableTemplate, paginateTemplate, type PlanComponent } from "../../index";
import { createColumnDirectory, searchColumnDirectory } from "../column-directory";

describe("wide report column directory", () => {
  it("extracts Chinese titles, groups datasets, deduplicates paginated headers and disambiguates repeated fields", () => {
    const plan = paginateTemplate(createTableTemplate({ title: "产量", columns: [{ header: "炉号", field: "heat" }, { header: "产重", field: "weight" }] }), { detail: [{ heat: "001", weight: 3 }] }).plan;
    const header = plan.pages[0]!.components.find((component) => component.table?.role === "header")!;
    header.table!.source = { datasetId: "steel" };
    const repeated = structuredClone(plan.pages[0]!);
    const other = structuredClone(header); other.table!.id = "second"; other.table!.source = { datasetId: "ladle" }; other.table!.title = "包重";
    plan.pages.push(repeated, { ...structuredClone(repeated), components: [other] });
    const directory = createColumnDirectory(plan, [{ label: "炼钢日报", pageIndex: 0 }, { label: "包报表", pageIndex: 2 }]);
    expect(directory).toHaveLength(4);
    expect(searchColumnDirectory(directory, "产重 steel")).toMatchObject([{ field: "weight", label: "产重", datasetId: "steel", tableId: header.table!.id, pageIndex: 0 }]);
    expect(searchColumnDirectory(directory, "heat").map((entry) => entry.group)).toEqual(["炼钢日报 · 产量 · steel", "包报表 · 包重 · ladle"]);
  });
  it("combines merged multilevel header paths while preserving exact machine fields", () => {
    const header: PlanComponent = { kind: "text", leftMm: 0, topMm: 0, widthMm: 80, heightMm: 16,
      table: { id: "grouped", role: "header", rowIndex: -1, columnKeys: ["heat", "sum"] },
      grid: { colWidthsMm: [40, 40], rowHeightsMm: [8, 8], cells: [[{ text: "生产", colSpan: 2 }], [{ text: "炉号" }, { text: "总量" }]] } };
    const directory = createColumnDirectory({ schemaVersion: "test", pages: [{ pageWidthMm: 80, pageHeightMm: 50, components: [header] }] });
    expect(directory.map((entry) => entry.label)).toEqual(["生产 / 炉号", "生产 / 总量"]);
    expect(searchColumnDirectory(directory, "生产 总量")[0]?.field).toBe("sum");
    expect(createColumnDirectory(null)).toEqual([]);
  });
});
