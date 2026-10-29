import { createLabelTemplate, defineReportTemplate, type DatasetContract, type PlanComponent, type ReportTemplateDocument } from "@agile-team/mach-report";

/** A small editable starter, built from the declared contract rather than invented business values. */
export function createLabelStudioDocument(schema: DatasetContract, title: string, identityField?: string): ReportTemplateDocument {
  const identity = identityField ?? schema.fields.find(field => field.semanticRole === "identifier" && field.field !== schema.rowKey)?.field ?? schema.rowKey ?? schema.fields[0]?.field;
  const text = (value: string, x: number, y: number, width: number, height = 4, size = 7): PlanComponent => ({ kind: "text", text: value, leftMm: x, topMm: y, widthMm: width, heightMm: height, style: { fontSize: size, color: "#254566", verticalAlign: "middle" } });
  const line = (topMm: number): PlanComponent => ({ kind: "line", leftMm: 4, topMm, widthMm: 72, heightMm: 0.2, style: { lineColor: "#c7d7e8", lineWidthPt: 0.5 } });
  const front: PlanComponent[] = [text(title, 4, 3, 72, 5, 9), line(10)];
  const back: PlanComponent[] = [text(title, 4, 4, 72, 5, 9)];
  if (identity) {
    front.push({ ...text("", 4, 12, 72, 8, 15), binding: { field: identity } });
    front.push({ kind: "qrcode", leftMm: 54, topMm: 21, widthMm: 21, heightMm: 21, binding: { field: identity }, code: { quietZoneModules: 4, errorCorrection: "M" } });
    back.push({ ...text("", 4, 12, 72, 8, 16), style: { fontSize: 16, align: "center", color: "#254566" }, binding: { field: identity } });
    back.push({ kind: "barcode", leftMm: 7, topMm: 24, widthMm: 66, heightMm: 15, binding: { field: identity }, code: { symbology: "code128", quietZoneModules: 10, showText: true } });
  }
  schema.fields.filter(field => field.field !== identity && field.field !== schema.rowKey).slice(0, 4).forEach((field, index) => {
    const y = 22 + index * 5;
    front.push(text(field.label ?? field.field, 4, y, 21, 4, 6));
    front.push({ ...text("", 25, y, 27, 4, 7), binding: { field: field.field, ...(field.format ? { format: field.format } : {}) } });
  });
  front.push(line(45), text(schema.fields.find(field => field.field === identity)?.label ?? title, 4, 47, 72, 4, 6));
  back.push(line(44));
  return defineReportTemplate({ id: "record-label", name: title, template: createLabelTemplate({ dataset: "records", rowKey: schema.rowKey, pages: [{ components: front }, { components: back }] }) });
}
