/** Synthetic content only: no production data, URLs, credentials or inferred business rules. */
export async function acceptanceFixtures(core, codes) {
  const rows = [
    { id: "000001", quantity: 0, ratio: 0, exact: "12345678901234567890.123456789012345678", note: "", enabled: false },
    { id: "000002", quantity: null, ratio: 0.125, exact: "0", note: "Unknown quantity stays blank; the first record is a real zero.", enabled: true }
  ];
  const template = core.createTableTemplate({ title: "Report acceptance", columns: [
    { field: "id", header: "ID", semanticRole: "identifier" }, { field: "quantity", header: "Quantity", valueType: "number" },
    { field: "ratio", header: "Ratio", format: { kind: "percent", digits: 2 } }, { field: "exact", header: "Exact decimal", semanticRole: "text", widthMm: 80 },
    { field: "enabled", header: "Enabled", valueType: "boolean" }
  ] });
  const table = core.paginateTemplate(template, { detail: rows }).plan;
  // This English Office fixture declares its display text separately from native boolean values.
  for (const page of table.pages) for (const component of page.components) for (const row of component.grid?.cells ?? []) for (const cell of row) {
    if (typeof cell?.value === "boolean") cell.text = cell.value ? "TRUE" : "FALSE";
  }
  const trace = "MACHREPORT:000001:0KG", serial = "000001";
  const qr = await codes.renderCodeImage({ kind: "qrcode", leftMm: 0, topMm: 0, widthMm: 21, heightMm: 21, code: { value: trace, quietZoneModules: 4, errorCorrection: "M" } }, { dpi: 203 });
  const barcode = await codes.renderCodeImage({ kind: "barcode", leftMm: 0, topMm: 0, widthMm: 65, heightMm: 14, code: { value: serial, symbology: "code128", quietZoneModules: 10, showText: true } }, { dpi: 203 });
  const label = { schemaVersion: core.RENDER_PLAN_SCHEMA_VERSION, pages: [{ pageWidthMm: 80, pageHeightMm: 55, components: [
    { kind: "text", leftMm: 4, topMm: 3, widthMm: 72, heightMm: 7, text: "MACHREPORT / 000001", style: { fontSize: 12, bold: true } },
    { kind: "text", leftMm: 4, topMm: 13, widthMm: 42, heightMm: 12, text: "Weight: 0 kg\nGrade: S304H3", style: { fontSize: 9 } },
    { kind: "image", leftMm: 53, topMm: 12, widthMm: 21, heightMm: 21, imageData: qr },
    { kind: "image", leftMm: 5, topMm: 36, widthMm: 65, heightMm: 14, imageData: barcode },
  ] }] };
  const rich = { schemaVersion: core.RENDER_PLAN_SCHEMA_VERSION, pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [
    { kind: "text", leftMm: 15, topMm: 15, widthMm: 180, heightMm: 40, style: { verticalAlign: "middle", fontFamily: "Helvetica" }, grid: { paddingMm: 2, colWidthsMm: [90, 90], rowHeightsMm: [40], cells: [[
      { text: "Value 42", editable: false, richParagraphs: [{ segments: [{ text: "Value ", style: { bold: true, color: "#173b56", fontSize: 12 } }, { text: "42", style: { italic: true, underline: true, fontSize: 16 } }] }] },
      { children: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: 40, heightMm: 12, text: "Nested", style: { bold: true } }, { kind: "image", leftMm: 50, topMm: 0, widthMm: 21, heightMm: 21, imageData: qr }] }
    ]] } }
  ] }] };
  const cjk = { schemaVersion: core.RENDER_PLAN_SCHEMA_VERSION, pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [
    { kind: "text", leftMm: 15, topMm: 15, widthMm: 180, heightMm: 20, text: "电炉日报", style: { fontSize: 20, fontFamily: "MachReportAcceptance" } },
  ] }] };
  return { rows, trace, serial, qr, barcode, plans: { "01-scalars": table, "02-rich-nested": rich, "03-label-80x55": label,
    "04-label-a4": core.imposeLabelSheets(label, { columns: 2, rows: 4, marginMm: 10, gapMm: 5 }), "05-chinese-font": cjk } };
}
