// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { decode } from "fast-png";
import { renderPlanToXlsx } from "../render-xlsx";
import { createTableTemplate } from "../../builder/table-template";
import { paginateTemplate } from "../../layout/paginate";
const fixture = () => paginateTemplate(createTableTemplate({ dataset: "data", layout: "wide", columns: [
  { field: "qty", header: "Quantity", visual: { kind: "dataBar", color: "#bad8fa" }, format: { kind: "number", digits: 2 } },
  { field: "ratio", header: "Ratio", visual: { kind: "colorScale", lowColor: "#ffffff", highColor: "#0000ff" } },
] }), { data: [{ qty: -10, ratio: 0 }, { qty: 0, ratio: 1 }, { qty: 20, ratio: 2 }, { qty: 10, ratio: null }] }).plan;
describe("native XLSX values with bounded static visual bars", () => {
  it("retains original cells and formats, shares PNG media and reads native drawing anchors back", async () => {
    const result = await renderPlanToXlsx(fixture(), { fidelity: "strict" });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.buffer);
    const sheet = workbook.worksheets[0]!; expect(sheet.getCell("A2").value).toBe(-10); expect(sheet.getCell("A3").value).toBe(0); expect(sheet.getCell("A4").numFmt).toBe("0.00");
    expect(sheet.getCell("B2").fill).toMatchObject({ fgColor: { argb: "FFFFFFFF" } }); expect(sheet.getCell("B4").fill).toMatchObject({ fgColor: { argb: "FF0000FF" } });
    expect(sheet.getImages()).toHaveLength(3); expect(workbook.model.media).toHaveLength(2);
    const pixel = result.workbook.model.media[0]! as unknown as { base64: string }; expect(pixel.base64).toBeDefined(); const image = decode(Buffer.from(pixel.base64!.split(",")[1]!, "base64")); expect(image.width).toBe(1); expect(image.height).toBe(1); expect(image.data[3]).toBe(89);
    expect(result.notes?.[0]).toContain("静态"); expect(result.diagnostics).toEqual([]);
  });
  it("preflights budgets and invalid options rather than silently omitting data bars", async () => {
    await expect(renderPlanToXlsx(fixture(), { maxDataBars: 2 })).rejects.toThrow("数据条超过 2");
    await expect(renderPlanToXlsx(fixture(), { maxDataBars: -1 })).rejects.toThrow("maxDataBars");
    await expect(renderPlanToXlsx(fixture(), { maxDataBars: 100001 })).rejects.toThrow("maxDataBars");
    const invalid = fixture(); invalid.pages[0]!.components.find(component => component.table?.role === "body")!.grid!.cells[0]![0]!.dataBar = { start: -1, end: 2, color: "#bad8fa" };
    await expect(renderPlanToXlsx(invalid, { fidelity: "strict" })).rejects.toMatchObject({ code: "output-fidelity" });
    const result = await renderPlanToXlsx(fixture(), { valueMode: "text", maxDataBars: 3 }); expect(result.workbook.worksheets[0]!.getImages()).toHaveLength(3); expect(result.workbook.worksheets[0]!.getCell("A2").value).toBe("-10.00");
  });
});
