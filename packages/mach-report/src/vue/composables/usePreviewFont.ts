import { computed, shallowRef, watch, type Ref } from "vue";
import type { RenderPlan } from "@agile-team/mach-report";
import { MachReportError } from "../errors";
import { createDefaultPdfExporter, type PdfExporter, type PdfFontCheckResult } from "../pdf-exporter";

/** Font probing and exporter caching share one lifecycle, independent of report interactions. */
export function usePreviewFont(host: {
  plan: Ref<RenderPlan | null>;
  fontUrl(): string;
  enabled(): boolean;
  injectedExporter: PdfExporter | null;
  destroyed(): boolean;
}) {
  const pdfFont = shallowRef<Readonly<PdfFontCheckResult>>(Object.freeze({ status: "unchecked", fontUrl: "" }));
  let cachedUrl: string | null = null;
  let cachedExporter: PdfExporter | null = null;
  let sequence = 0;
  let active: AbortController | null = null;
  function getPdfExporter(): PdfExporter {
    if (host.injectedExporter) return host.injectedExporter;
    const fontUrl = host.fontUrl();
    if (!cachedExporter || cachedUrl !== fontUrl) {
      cachedUrl = fontUrl; cachedExporter = createDefaultPdfExporter({ fontUrl });
    }
    return cachedExporter;
  }
  function cancelFontCheck(): void { sequence++; active?.abort(); active = null; }
  async function checkPdfFont(): Promise<PdfFontCheckResult> {
    if (host.destroyed()) throw new MachReportError("config", "报表预览已卸载");
    cancelFontCheck();
    const current = sequence;
    const controller = new AbortController(); active = controller;
    const fontUrl = host.fontUrl();
    pdfFont.value = Object.freeze({ status: "checking", fontUrl });
    try {
      const exporter = getPdfExporter();
      const result = exporter.checkFont ? await exporter.checkFont(controller.signal)
        : { status: "unverified" as const, fontUrl: "", message: "自定义 PDF 导出器未提供字体预检查；字体由宿主确认" };
      if (!host.destroyed() && current === sequence && !controller.signal.aborted) pdfFont.value = Object.freeze({ ...result });
      return result;
    } catch (cause) {
      if (controller.signal.aborted) throw cause;
      const result: PdfFontCheckResult = { status: "error", fontUrl, message: cause instanceof Error ? cause.message : "PDF 字体检查失败", cause };
      if (!host.destroyed() && current === sequence) pdfFont.value = Object.freeze(result);
      return result;
    } finally { if (active === controller) active = null; }
  }
  function retryPdfFont(): void { void checkPdfFont().catch(() => { /* Obsolete probes are cancelled. */ }); }
  watch([host.plan, computed(host.fontUrl), computed(host.enabled)], () => {
    const sameUrl = pdfFont.value.fontUrl === host.fontUrl();
    if (sameUrl && pdfFont.value.status === "available") return;
    cancelFontCheck();
    if (!sameUrl || pdfFont.value.status === "checking") pdfFont.value = Object.freeze({ status: "unchecked", fontUrl: host.fontUrl() });
    if (!host.destroyed() && host.plan.value?.pages.length && host.enabled()) retryPdfFont();
  }, { immediate: true });
  return { pdfFont, getPdfExporter, checkPdfFont, retryPdfFont, cancelFontCheck };
}
