import { defineReportTemplate, type DatasetRows } from "@agile-team/mach-report";

export const platformTemplate = defineReportTemplate({ id: "operations", name: "生产与成本综合报表", description: "合成验收数据 · 产量单记录 + 成本树形明细", template: {
  params: [{ field: "month", label: "核算月份", type: "month", required: true, defaultValue: "2026-10" }, { field: "period", label: "统计区间", type: "dateRange", defaultValue: "2026-10-01/2026-10-20" }],
  pages: [{ widthMm: 210, heightMm: 297, marginTopMm: 12, marginBottomMm: 12, components: [
    { kind: "text", nid: "heading", leftMm: 12, topMm: 12, widthMm: 186, heightMm: 14, text: "生产与成本综合报表", style: { fontSize: 18, color: "#234b80", bold: true } },
    { kind: "list", id: "production", dataset: "production", cardinality: "record", rowKey: "id", leftMm: 12, topMm: 30, widthMm: 186, rowHeightMm: 10, columns: [
      { field: "plant", header: "厂别", widthMm: 46, align: "center" }, { field: "weight", header: "产量（t）", widthMm: 46, align: "right", format: { kind: "number", digits: 3 } }, { field: "defects", header: "缺陷数", widthMm: 46, align: "right" }, { field: "rate", header: "产率（%）", widthMm: 48, align: "right" }
    ] },
    { kind: "text", nid: "cost-title", leftMm: 12, topMm: 54, widthMm: 186, heightMm: 8, text: "成本结构 · 叶子汇总", style: { color: "#234b80", bold: true } },
    { kind: "list", id: "cost", dataset: "cost", rowKey: "id", leftMm: 12, topMm: 66, widthMm: 186, rowHeightMm: 9, tree: { input: "flat", idField: "id", parentField: "parent", labelField: "name", parentValues: "leaf-aggregate", aggregates: [{ field: "amount", op: "sum", numeric: "decimal", digits: 2 }] }, columns: [
      { field: "name", header: "成本项目", widthMm: 110 }, { field: "amount", header: "金额（元）", widthMm: 76, align: "right", format: { kind: "number", digits: 2, thousands: true } }
    ], grandTotal: { label: "成本合计", aggregates: [{ field: "amount", op: "sum", numeric: "decimal", digits: 2 }] } },
    { kind: "text", nid: "note", leftMm: 12, topMm: 78, widthMm: 186, heightMm: 8, text: "合成示例，非生产实绩。空白保持未知，真实 0 保留。", style: { fontSize: 9, color: "#64748b" } }
  ], flow: { bands: [{ componentIds: ["heading"], topMm: 12, heightMm: 14 }, { componentIds: ["production"], topMm: 30, heightMm: 20 }, { componentIds: ["cost-title"], topMm: 54, heightMm: 8 }, { componentIds: ["cost"], topMm: 66, heightMm: 9 }, { componentIds: ["note"], topMm: 78, heightMm: 8 }] } }]
} });
export const platformDatasets: DatasetRows = {
  production: [{ id: "p1", plant: "YTS0", weight: "1284.225", defects: 0, rate: null }],
  cost: [{ id: "raw", parent: null, name: "原材料", amount: null }, { id: "steel", parent: "raw", name: "废钢", amount: "1234567890123456.12" }, { id: "alloy", parent: "raw", name: "合金", amount: "20000.08" }, { id: "energy", parent: null, name: "能源", amount: null }, { id: "power", parent: "energy", name: "电力", amount: "36800.00" }, { id: "gas", parent: "energy", name: "燃气", amount: 0 }]
};
