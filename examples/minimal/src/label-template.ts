import { createLabelTemplate, defineReportTemplate, type ComponentStyle, type PlanComponent, type DatasetContract } from "@agile-team/mach-report";

const ink = "#172f4d", muted = "#53677d";
function text(text: string, leftMm: number, topMm: number, widthMm: number, heightMm = 4, style: ComponentStyle = {}): PlanComponent {
  return { kind: "text", text, leftMm, topMm, widthMm, heightMm, style: { fontSize: 7, lineHeight: 1.15, color: ink, verticalAlign: "middle", ...style } };
}
function field(label: string, name: string, top: number, suffix?: string, digits?: number): PlanComponent[] {
  return [text(label, 4, top, 24, 4, { color: muted, fontSize: 6.2 }), { ...text("", 28, top, 24, 4, { fontSize: 8 }), binding: { field: name, ...(suffix ? { suffix } : {}), ...(digits === undefined ? {} : { format: { kind: "number", digits } }) } }];
}
function rule(topMm: number): PlanComponent {
  return { kind: "line", leftMm: 4, topMm, widthMm: 72, heightMm: 0.2, style: { lineColor: "#b9c8d7", lineWidthPt: 0.45 } };
}
const front: PlanComponent[] = [
  text("MACH STEEL", 4, 3, 37, 6, { fontSize: 13, color: "#174a79" }),
  text("材料追溯 / MATERIAL TRACE", 42, 3, 34, 3.5, { align: "right", fontSize: 6 }),
  text("PRODUCT LABEL · 产品标识", 42, 6.5, 34, 3, { align: "right", fontSize: 5.8, color: muted }),
  rule(11),
  { ...text("", 4, 13, 45, 6, { fontSize: 14 }), binding: { field: "grade" } },
  ...field("产品状态  CONDITION", "condition", 20),
  ...field("产品尺寸  SIZE", "size", 24, " mm", 1),
  ...field("产品重量  WEIGHT", "weight", 28, " kg"),
  ...field("产制炉号  HEAT NO.", "heat", 32),
  ...field("产品编号  COIL NO.", "coil", 36),
  ...field("检验员  INSPECTOR", "inspector", 40),
  { kind: "qrcode", nid: "trace-qr", leftMm: 55, topMm: 19, widthMm: 21, heightMm: 21, binding: { field: "trace" }, code: { errorCorrection: "M", quietZoneModules: 4 } },
  text("SCAN TO TRACE", 54, 40.5, 23, 3.5, { align: "center", color: muted, fontSize: 5.5 }),
  rule(45),
  text("执行标准  STANDARD", 4, 46, 25, 3.8, { color: muted, fontSize: 6 }),
  { ...text("", 29, 46, 47, 3.8, { align: "right", fontSize: 6.5 }), binding: { field: "standard" } },
  { ...text("", 4, 50, 60, 3, { fontSize: 5.8, color: muted }), binding: { field: "serial", prefix: "SERIAL / " } },
  text("01 / 02", 66, 50, 10, 3, { align: "right", color: muted, fontSize: 5.8 }),
];
const back: PlanComponent[] = [
  text("仓储识别 / WAREHOUSE IDENTIFICATION", 4, 4, 72, 4, { fontSize: 7, color: muted }),
  { ...text("", 4, 10, 72, 7, { fontSize: 17, align: "center" }), binding: { field: "serial" } },
  { kind: "barcode", nid: "serial-barcode", leftMm: 7, topMm: 20, widthMm: 66, heightMm: 15, binding: { field: "serial" }, code: { symbology: "code128", quietZoneModules: 10, showText: true } },
  rule(39),
  { ...text("", 4, 41, 35, 5, { fontSize: 9 }), binding: { field: "grade" } },
  { ...text("", 40, 41, 36, 5, { fontSize: 9, align: "right" }), binding: { field: "weight", suffix: " kg" } },
  text("与正面标签保持相邻 · 按物料逐份生成", 4, 49, 60, 3.5, { fontSize: 5.8, color: muted }),
  text("02 / 02", 66, 49, 10, 3.5, { align: "right", color: muted, fontSize: 5.8 }),
];
export const labelContract: DatasetContract = {
  rowKey: "serial",
  fields: [
    { field: "serial", label: "产品流水号", type: "text", semanticRole: "identifier", required: true },
    { field: "grade", label: "钢种", type: "text", semanticRole: "dimension" },
    { field: "condition", label: "产品状态", type: "text", semanticRole: "dimension" },
    { field: "size", label: "产品尺寸", type: "number", semanticRole: "measure", unit: "mm", min: 0 },
    { field: "weight", label: "产品重量", type: "number", semanticRole: "measure", unit: "kg", min: 0 },
    { field: "heat", label: "产制炉号", type: "text", semanticRole: "identifier" },
    { field: "coil", label: "产品编号", type: "text", semanticRole: "identifier" },
    { field: "inspector", label: "检验员", type: "text", semanticRole: "dimension" },
    { field: "standard", label: "执行标准", type: "text", semanticRole: "dimension" },
    { field: "trace", label: "追溯编码", type: "text", semanticRole: "identifier" },
  ],
};
export const labelRows = [
  { serial: "MR26010001", grade: "S304H3", condition: "HRP 热加工酸洗", size: 5.5, weight: 500, heat: "DEMO2601", coil: "A001", inspector: "QA001", standard: "MR-MAT-TS-02-01-2024", trace: "MACH:MR26010001:S304H3:500KG" },
  { serial: "MR26010002", grade: "S316LS", condition: "HRP 热加工酸洗", size: 6, weight: 0, heat: "DEMO2602", coil: "B002", inspector: "QA002", standard: "MR-MAT-TS-02-01-2024", trace: "MACH:MR26010002:S316LS:0KG" },
];
export const labelDocument = defineReportTemplate({
  id: "industrial-label", name: "工业材料标签 · 80 × 55 mm",
  description: "合成示例 · 字段绑定、双版顺序、真实二维码与条码。",
  template: createLabelTemplate({ dataset: "materials", rowKey: "serial", pages: [{ meta: { title: "产品标识 · 正版" }, components: front }, { meta: { title: "仓储识别 · 背版" }, components: back }] }),
});
