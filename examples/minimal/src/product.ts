import { createApp, h, ref } from "vue";
import {
  ReportPreview, createTableTemplate, defineMachReportConfig, machReportPlugin, useMachReport,
  type DatasetRows, type PlanGrid, type ReportLoadContext, type ReportRegistry, type TableTemplateColumn
} from "@agile-team/mach-report/vue";
import "./product.css";

type Layout = "wide" | "a3" | "a4" | "review";
const choices: Array<{ id: Layout; label: string; hint: string }> = [
  { id: "wide", label: "完整宽表", hint: "44 列自然宽度" }, { id: "a3", label: "A3 横向", hint: "标准纸型" },
  { id: "a4", label: "A4 横向", hint: "标准纸型" }, { id: "review", label: "诊断样例", hint: "明确展示已知降级" }
];
const numberFormat = { kind: "number" as const, digits: 2, thousands: true };
const columns: TableTemplateColumn[] = [
  { field: "heat", header: "Heat", semanticRole: "identifier", editable: false },
  { field: "line", header: "Line", semanticRole: "dimension", editable: false },
  { field: "grade", header: "Grade", semanticRole: "dimension", editable: true },
  { field: "approved", header: "OK", semanticRole: "dimension", valueType: "boolean", align: "center", editable: true },
  { field: "plannedOn", header: "Date", semanticRole: "date", editable: true },
  { field: "target", header: "Target", semanticRole: "measure", editable: true, format: numberFormat },
  { field: "weight", header: "Weight", semanticRole: "measure", editable: false, format: numberFormat },
  { field: "energy", header: "Energy", semanticRole: "measure", editable: false, format: numberFormat },
  ...Array.from({ length: 36 }, (_, index): TableTemplateColumn => ({
    field: `metric${index + 1}`, header: `M${String(index + 1).padStart(2, "0")}`, semanticRole: "measure", editable: false, format: numberFormat
  }))
];
const rows = Array.from({ length: 144 }, (_, index) => ({
  heat: String(index + 1).padStart(6, "0"), line: index < 72 ? "EAF-1" : "EAF-2", grade: index % 2 ? "316L" : "304L",
  approved: index % 3 !== 0, plannedOn: `2026-10-${String(index % 28 + 1).padStart(2, "0")}`,
  target: index === 0 ? 0 : 65.5, weight: index === 0 ? 0 : 62000 + index * 13.25, energy: 26000 + index * 8.5,
  ...Object.fromEntries(Array.from({ length: 36 }, (_, metric) => [`metric${metric + 1}`, (index + metric) % 17 === 0 ? null : Math.round((index + 1) * (metric + 1) * 1.23) / 100]))
}));

function headerGrid(): PlanGrid {
  const style = { align: "center" as const, verticalAlign: "middle" as const, bold: true, color: "#173b56", backgroundColor: "#e9f0f7" };
  return { cells: [
    [{ text: "Identity & workflow", colSpan: 8, style }, { text: "Process / M01-M12", colSpan: 12, style }, { text: "Quality / M13-M24", colSpan: 12, style }, { text: "Efficiency / M25-M36", colSpan: 12, style }],
    columns.map((column) => ({ text: column.header, style }))
  ], rowHeightsMm: [7, 7] };
}

function template(layout: Layout) {
  const paper = layout === "a3" || layout === "a4";
  const report = createTableTemplate({
    title: "PRODUCTION / OPERATIONS REPORT", titleStyle: { align: "left", fontSize: 15, bold: true, color: "#173b56" },
    ...(paper ? { paper: layout, landscape: true } : { layout: "wide" as const, columnWidthMm: 27 }),
    columns, params: [{ field: "line", label: "产线", type: "select", required: true, defaultValue: "ALL", options: [{ label: "全部产线", value: "ALL" }, { label: "EAF-1", value: "EAF-1" }, { label: "EAF-2", value: "EAF-2" }] }],
    listOptions: {
      rowKey: "heat", fontSizePt: paper ? 6.5 : 9.5, paddingMm: paper ? 0.35 : 1, rowHeightMm: 7,
      align: "auto", headerGrid: headerGrid(), headerEveryPage: true,
      groupBy: { field: "line", headerTemplate: "LINE / {value}", headerStyle: { bold: true, backgroundColor: "#eaf5f2", color: "#136657" }, subtotal: ["weight", "energy"], subtotalLabel: "LINE TOTAL", subtotalStyle: { bold: true, backgroundColor: "#f0f5fa" } },
      grandTotal: { label: "GRAND TOTAL", fields: ["weight", "energy"], style: { bold: true, backgroundColor: "#dfeaf5", color: "#173b56" } }
    }
  });
  if (layout === "review") report.pages[0]!.components.push({ kind: "chart", nid: "intentional-unbound-chart", leftMm: report.pages[0]!.widthMm - 38, topMm: 8, widthMm: 25, heightMm: 10, fallbackText: "CHART" });
  return report;
}

/** Explicit local adapter, with a short abortable delay so query/cancel states can be experienced. */
function load({ params, signal }: ReportLoadContext): Promise<DatasetRows> {
  return new Promise((resolve, reject) => {
    function abort(): void { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); }
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve({ detail: params.line === "ALL" ? rows : rows.filter((row) => row.line === params.line) }); }, 220);
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  });
}
const reports: ReportRegistry = Object.fromEntries(choices.map(({ id }) => [`product-${id}`, { template: template(id), load }]));

const app = createApp({ setup() {
  const report = useMachReport();
  const layout = ref<Layout>("wide");
  async function choose(next: Layout): Promise<void> {
    if (next === layout.value || !await report.confirmDiscard("replace")) return;
    // The explicit guard approves unmounting this draft; the new instance starts clean.
    layout.value = next;
  }
  return () => h("main", { class: "product-shell" }, [
    h("header", { class: "product-heading" }, [
      h("a", { class: "product-brand", href: "/", "aria-label": "MachReport 首页" }, ["M", h("span", "R")]),
      h("div", { class: "product-title" }, [h("p", "MACHREPORT / PRODUCT WORKBENCH"), h("h1", "让复杂报表，依然清晰好用"), h("p", "完整宽表 · 类型编辑 · 多级表头 · 分组汇总")]),
      h("a", { class: "designer-link", href: "/designer.html" }, "模板属性工作台 ↗")
    ]),
    h("section", { class: "product-context", "aria-label": "体验说明" }, [
      h("div", { class: "product-local" }, [h("span", { class: "local-dot" }), "本地演示数据", h("small", "144 行 × 44 列 · 不连接业务数据库")]),
      h("p", "双击 Grade、OK、Date、Target 体验枚举、布尔、日期及数字编辑。修改仅为本地草稿；分组汇总使用只读 Weight / Energy，不随草稿重算。0.00 为真实零，空白为未提供，编号前导零原样保留。"),
      h("p", { class: "product-font-note" }, "字段名使用英文，布尔值显示为是 / 否。此页未配置覆盖全部字符的 PDF 字体，PDF 出口默认关闭；接入时请配置完整业务字体后开放，不能沿用演示子集字体。")
    ]),
    h("div", { class: "product-toolbar" }, [
      h("nav", { class: "product-layouts", "aria-label": "显示版式" }, choices.map((choice) => h("button", { type: "button", "aria-pressed": layout.value === choice.id, class: { selected: layout.value === choice.id }, disabled: report.state.loading || report.state.saving || report.state.importing || !!report.state.exporting, onClick: () => void choose(choice.id) }, [h("strong", choice.label), h("span", choice.hint)]))),
      h("span", { class: "product-state", role: "status" }, report.state.pendingLocalChanges ? "● 有未保存草稿" : report.state.loading ? "正在读取本地数据…" : `${report.state.pageCount} 个预览分段 · 设置内可配置工具`)
    ]),
    h("section", { class: "product-preview", "aria-label": "复杂报表预览" }, [h(ReportPreview, { key: layout.value, ref: report.ref, reportId: `product-${layout.value}` })]),
    h("footer", { class: "product-footer" }, layout.value === "review" ? "诊断样例故意保留一个尚未提供图片适配器的图表。原生诊断面板将说明位置；严格输出会拒绝生成已知缺项的文件。" : "工具由 MachReport 原生提供：设置、冻结、列目录、搜索、撤销重做、导入导出、任务进度及草稿保护。A3/A4 保留全部列，密集字段建议优先使用完整宽表阅读。")
  ]);
} });
app.use(machReportPlugin, { reports, config: defineMachReportConfig({ defaults: {
  pdfFontUrl: "", showPdfWindow: false, toolbar: { exportFormats: ["html", "xlsx", "png", "word"] }, output: { fidelity: "strict" }, editable: { fields: {
    grade: { type: "enum", label: "Grade", options: [{ value: "304L" }, { value: "316L" }, { value: "321" }] },
    approved: { type: "boolean", label: "Approved", trueLabel: "Yes", falseLabel: "No" },
    plannedOn: { type: "date", label: "Planned date", min: "2026-01-01", max: "2027-12-31" },
    target: { type: "number", label: "Target", unit: "t", min: 0, max: 160, precision: 2, hint: "Local draft; readonly totals do not depend on this field." }
  } }, excelImport: true, interaction: { navigation: true }, theme: {
    shellBg: "#f2f5f8", shellFg: "#20374f", toolbarBg: "#ffffff", toolbarFg: "#344b63", toolbarBorder: "#e1e8ef",
    btnFg: "#34506d", btnBorder: "#d3dfeb", btnHoverBg: "#edf4fa", btnHoverFg: "#173b56", btnActiveBg: "#1b5577"
  }
} }) });
app.mount("#app");
