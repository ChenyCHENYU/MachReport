import { createApp, h, ref, computed } from "vue";
import { ReportPreview, createLocalFetcher, machReportPlugin } from "@agile-team/mach-report-vue";
import type { ReportTemplate } from "@agile-team/mach-report-core";
import { renderDynamicSql } from "@agile-team/mach-report-sql-engine";

let cachedTemplateRef: { template: ReportTemplate; datasets: Record<string, Record<string, unknown>[]> } | null = null;

let pagerRef: { destroy(): void; window(): { start: number; end: number } } | null = null;

async function exportPdf(): Promise<void> {
  const entry = cachedTemplateRef;
  if (!entry) return;
  const [{ renderPlanToPdf, loadFontWithCache }, { paginateTemplate }] = await Promise.all([
    import("@agile-team/mach-report-pdf"),
    import("@agile-team/mach-report-core")
  ]);
  const { plan } = paginateTemplate(entry.template, entry.datasets);
  const font = await loadFontWithCache("/simhei.ttf");
  const { bytes } = await renderPlanToPdf(plan, font ? { customFontBytes: font } : {});
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mach-report.pdf";
  a.click();
  URL.revokeObjectURL(url);
}

async function showCanvas(): Promise<void> {
  const entry = cachedTemplateRef;
  if (!entry) return;
  const { renderPlanToCanvas, paginateTemplate } = await import("@agile-team/mach-report-core");
  const { plan } = paginateTemplate(entry.template, entry.datasets);
  const { canvases } = renderPlanToCanvas(plan, { dpr: 1 });
  const overlay = ensureOverlay();
  renderOverlayPages(overlay, canvases, "Canvas 位图渲染", "done");
}

/** 校准渲染：已知位置纯色块，供 E2E 做结构化像素断言（Y 轴方向/几何换算回归检测） */
async function showCanvasCalibration(): Promise<void> {
  const { renderPlanToCanvas } = await import("@agile-team/mach-report-core");
  const plan = {
    schemaVersion: "calibration",
    pages: [
      {
        pageWidthMm: 210,
        pageHeightMm: 297,
        components: [
          {
            kind: "rect" as const,
            leftMm: 20,
            topMm: 20,
            widthMm: 30,
            heightMm: 12,
            style: { backgroundColor: "#ff0000", borderColor: "#ff0000" }
          }
        ]
      }
    ]
  };
  const { canvases } = renderPlanToCanvas(plan, { dpr: 1 });
  const overlay = ensureOverlay();
  renderOverlayPages(overlay, canvases, "Canvas 校准渲染（左上 20mm 处红色块）", "calibration");
}

/**
 * 窗口化 Canvas 分页器演示：96 行多页报表只按视口渲染（画布池 + 分帧），
 * 内存 O(窗口) 而非 O(总页数)——大报表（百页级）Canvas 渲染的正确姿势。
 */
async function showCanvasPager(): Promise<void> {
  const entry = cachedTemplateRef;
  if (!entry) return;
  const { createCanvasPager, paginateTemplate } = await import("@agile-team/mach-report-core");
  const { plan } = paginateTemplate(entry.template, entry.datasets);
  pagerRef?.destroy();
  let overlay = document.getElementById("canvas-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "canvas-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:#323639;overflow:auto;z-index:999;padding:16px";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = "";
  const info = document.createElement("div");
  info.style.cssText =
    "position:sticky;top:0;z-index:2;background:#22252a;color:#eee;padding:6px 10px;font-size:12px";
  info.dataset.pagerInfo = "total";
  info.textContent = `Canvas 窗口化分页器：共 ${plan.pages.length} 页（滚动按需绘制，画布池复用）`;
  overlay.appendChild(info);
  const viewport = document.createElement("div");
  viewport.dataset.pagerViewport = "1";
  viewport.style.cssText = "height:calc(100vh - 60px);overflow:auto;";
  overlay.appendChild(viewport);
  const pager = createCanvasPager(plan, { dpr: 1, overscan: 1 });
  pager.attach(viewport);
  pagerRef = pager;
  // 滚动时把窗口区间上报到信息条（E2E 可断言窗口化生效）
  viewport.addEventListener("scroll", () => {
    requestAnimationFrame(() => {
      const w = pager.window();
      info.textContent = `Canvas 窗口化分页器：共 ${plan.pages.length} 页，当前渲染窗口 [${w.start}, ${w.end}]`;
    });
  }, { passive: true });
}

function ensureOverlay(): HTMLElement {
  let overlay = document.getElementById("canvas-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "canvas-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;background:#323639;overflow:auto;z-index:999;padding:16px";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = "";
  overlay.appendChild(document.createElement("div"));
  return overlay;
}

function renderOverlayPages(
  overlay: HTMLElement,
  canvases: HTMLCanvasElement[],
  title: string,
  marker: string
): void {
  const info = document.createElement("div");
  info.style.cssText = "position:sticky;top:0;background:#22252a;color:#eee;padding:6px 10px;font-size:12px";
  info.textContent = `${title}：${canvases.length} 页`;
  overlay.appendChild(info);
  for (const c of canvases) {
    c.dataset.canvasRender = marker;
    c.style.cssText = "display:block;margin:12px auto;box-shadow:0 2px 8px #0008";
    overlay.appendChild(c);
  }
}

const deliveryNote: ReportTemplate = {
  pages: [
    {
      widthMm: 210,
      heightMm: 297,
      marginTopMm: 12,
      marginBottomMm: 12,
      components: [
        { kind: "text", leftMm: 55, topMm: 2, widthMm: 100, heightMm: 12, text: "产品出库单", style: { fontSize: 16, bold: true, align: "center" } },
        { kind: "text", leftMm: 12, topMm: 16, widthMm: 90, heightMm: 7, text: "单据编号：CK-20260917-0001", style: { fontSize: 9 } },
        { kind: "text", leftMm: 108, topMm: 16, widthMm: 90, heightMm: 7, text: "打印时间：2026-09-17", style: { fontSize: 9, align: "right" } },
        {
          kind: "list",
          id: "detail",
          leftMm: 12,
          topMm: 26,
          widthMm: 186,
          dataset: "detail",
          fontSizePt: 10.5,
          headerBackgroundColor: "#eef2f8",
          columns: [
            { header: "序号", field: "no", widthMm: 16 },
            { header: "物料编码", field: "code", widthMm: 40 },
            { header: "物料名称", field: "name", widthMm: 70 },
            { header: "规格", field: "spec", widthMm: 30 },
            { header: "数量", field: "qty", widthMm: 30, style: { align: "right" } }
          ]
        }
      ]
    }
  ]
};

const processCard: ReportTemplate = {
  pages: [
    {
      widthMm: 210,
      heightMm: 297,
      marginTopMm: 10,
      marginBottomMm: 14,
      components: [
        { kind: "text", leftMm: 45, topMm: 2, widthMm: 120, heightMm: 10, text: "冶炼浇注工艺卡（LF 精炼）", style: { fontSize: 14, bold: true, align: "center" } },
        { kind: "rect", leftMm: 12, topMm: 14, widthMm: 186, heightMm: 20, style: { borderColor: "#333", lineWidthPt: 0.75 } },
        { kind: "text", leftMm: 15, topMm: 16, widthMm: 55, heightMm: 7, text: "卡号：MP-20260917-01", style: { fontSize: 9 } },
        { kind: "text", leftMm: 15, topMm: 25, widthMm: 55, heightMm: 7, text: "钢种：Q355B", style: { fontSize: 9 } },
        { kind: "text", leftMm: 80, topMm: 16, widthMm: 55, heightMm: 7, text: "炉号：L-0917", style: { fontSize: 9 } },
        { kind: "text", leftMm: 80, topMm: 25, widthMm: 55, heightMm: 7, text: "重量：42.5t", style: { fontSize: 9 } },
        { kind: "text", leftMm: 140, topMm: 16, widthMm: 55, heightMm: 7, text: "工位：LF-2", style: { fontSize: 9 } },
        { kind: "text", leftMm: 140, topMm: 25, widthMm: 55, heightMm: 7, text: "班次：甲班", style: { fontSize: 9 } },
        {
          kind: "list",
          id: "steps",
          leftMm: 12,
          topMm: 38,
          widthMm: 186,
          dataset: "steps",
          fontSizePt: 10,
          columns: [
            { header: "工序", field: "step", widthMm: 36 },
            { header: "参数项", field: "param", widthMm: 50 },
            { header: "目标值", field: "target", widthMm: 50 },
            { header: "实绩", field: "actual", widthMm: 50 }
          ]
        }
      ]
    }
  ]
};

function makeDetail(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    no: String(i + 1),
    code: `WL-${String(1000 + i)}`,
    name: `合金结构钢坯 ${i + 1}`,
    spec: i % 2 === 0 ? "150×150×6000" : "180×220×8000",
    qty: `${(i + 1) * 3} 支`
  }));
}

function makeSteps() {
  const rows: Record<string, string>[] = [];
  const steps = [
    ["进站温度", "≥1550℃", "1556℃"],
    ["白渣保持", "≥15min", "18min"],
    ["出站温度", "1590-1610℃", "1601℃"],
    ["钙处理", "0.8-1.2kg/t", "1.0kg/t"],
    ["软吹时间", "≥8min", "10min"],
    ["硫含量", "≤0.020%", "0.012%"],
    ["磷含量", "≤0.030%", "0.022%"]
  ];
  for (const [param, target, actual] of steps) {
    rows.push({ step: "LF 精炼", param: param!, target: target!, actual: actual! });
  }
  return rows;
}

const entries = {
  delivery: { tempId: "delivery", template: deliveryNote, datasets: { detail: makeDetail(96) } },
  card: { tempId: "card", template: processCard, datasets: { steps: makeSteps() } },
  combined: { tempId: "combined", template: deliveryNote, datasets: { detail: makeDetail(20) } }
};

const fetcher = createLocalFetcher(entries);
const fetcherWithCache = async (input: Parameters<typeof fetcher>[0]) => {
  const id = input.tempIds[0] ?? "";
  cachedTemplateRef = entries[id]
    ? { template: entries[id]!.template, datasets: entries[id]!.datasets ?? {} }
    : { template: entries["combined"]!.template, datasets: entries["combined"]!.datasets ?? {} };
  return fetcher(input);
};
const currentTemp = ref<string | string[]>("delivery");
const tempIds = computed(() =>
  currentTemp.value === "combined" ? ["combined", "card"] : currentTemp.value
);

const sqlDemo = renderDynamicSql(
  "select * from t_warehouse where 1=1 {if(isEmpty(#id), \"\", \"and id = #{id}\")}",
  { id: "" }
);

const app = createApp({
  setup() {
    const pick = (id: string) => {
      currentTemp.value = id;
    };
    return () =>
      h("div", { class: "wrap", style: "display:flex;height:100%" }, [
        h("div", { class: "side" }, [
          h("h3", null, "MachReport Demo"),
          h("button", { onClick: () => pick("delivery") }, "出库单（96 行，多页）"),
          h("button", { onClick: () => pick("card") }, "工艺卡（LF 精炼）"),
          h("button", { onClick: () => pick("combined") }, "多模板拼接（出库单+工艺卡）"),
          h("button", { onClick: () => void exportPdf() }, "导出 PDF（前端直出）"),
          h("button", { onClick: () => void showCanvas() }, "Canvas 位图渲染"),
          h("button", { onClick: () => void showCanvasCalibration() }, "Canvas 校准渲染"),
          h("button", { onClick: () => void showCanvasPager() }, "Canvas 窗口化（大报表）"),
          h("div", { class: "info" }, [
            h("div", null, `sql-engine 演示渲染结果：`),
            h("div", { style: "word-break:break-all" }, sqlDemo.sql)
          ])
        ]),
        h("div", { class: "main" }, [
          // 不加 :key：验证组件内部 watch tempId 的重载与竞态防护（契约要求零改动切换）
          h(ReportPreview, {
            tempId: tempIds.value,
            fetcher: fetcherWithCache,
            height: "100vh"
          })
        ])
      ]);
  }
});

// 插件化注册演示：数据面一次注入，ReportPreview 不传 fetcher 也能取到（此处仍显式传以便对比）
app.use(machReportPlugin, { fetcher: fetcherWithCache });

app.mount("#app");
