import type { OutputDiagnostic } from "@agile-team/mach-report";
import type { OutputTaskOptions } from "../output/progress";
import { assertOutputActive, waitForOutput } from "../output/progress";
import type { RenderPlan } from "@agile-team/mach-report";
import type { ReportPdfFontOptions } from "../server/types";

/** available 仅表示字体资源可达；实际导出仍会校验文字能否编码。 */
export type PdfFontStatus = "unchecked" | "checking" | "available" | "disabled" | "unverified" | "error";

export interface PdfFontCheckResult {
  status: PdfFontStatus;
  fontUrl: string;
  message?: string;
  cause?: unknown;
}

/** PDF 导出器：RenderPlan → PDF 字节；第二参数可上报非致命保真告警。 */
export interface PdfExporter {
  (plan: RenderPlan, onWarning?: (message: string) => void, task?: OutputTaskOptions & { onDiagnostic?: (entry: OutputDiagnostic) => void }): Promise<Uint8Array>;
  /** 可选轻量字体检查；旧版自定义导出函数无需实现。取消时拒绝 AbortError。 */
  checkFont?: (signal?: AbortSignal) => Promise<PdfFontCheckResult>;
  /** Optional resource preparation for isolated encoding; custom exporters without it keep their own pipeline. */
  prepare?: (signal?: AbortSignal) => Promise<ReportPdfFontOptions>;
}

export interface DefaultPdfExporterOptions {
  /** 中文字体 URL（浏览器 fetch）；空串跳过字体加载（西文报表） */
  fontUrl: string;
}

interface FontCheckFlight {
  controller: AbortController;
  promise: Promise<PdfFontCheckResult>;
  subscribers: number;
}

const availableFonts = new Map<string, PdfFontCheckResult>();
const fontChecks = new Map<string, FontCheckFlight>();
const FONT_CHECK_TIMEOUT_MS = 15_000;

function withCause(message: string, cause: unknown): Error & { cause: unknown } {
  return Object.assign(new Error(message), { cause });
}

function fontHint(fontUrl: string, detail: string): string {
  return `PDF 字体 ${JSON.stringify(fontUrl)}：${detail}。请部署支持报表文字的字体文件，并将 pdfFontUrl 配置为可访问的字体 URL；西文报表可设为空串`;
}

async function requiredFont(fontUrl: string, load: typeof import("../pdf/font-loader").loadFontWithCache, signal?: AbortSignal): Promise<Uint8Array | null> {
  assertOutputActive(signal);
  if (!fontUrl) return null;
  try {
    const font = await waitForOutput(load(fontUrl, { strict: true, signal }), signal);
    if (!font?.byteLength) throw new Error("字体文件为空或加载失败");
    return font;
  } catch (cause) {
    assertOutputActive(signal);
    throw withCause(fontHint(fontUrl, cause instanceof Error ? cause.message : String(cause)), cause);
  }
}

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error && signal.reason.name === "AbortError") return signal.reason;
  const error = withCause("PDF 字体检查已取消", signal?.reason);
  error.name = "AbortError";
  return error;
}

async function checkFontResource(fontUrl: string, controller: AbortController): Promise<PdfFontCheckResult> {
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FONT_CHECK_TIMEOUT_MS);
  try {
    // 只读取 HEAD 响应头，不获取大字体，也不加载 PDF 模块。
    const response = await fetch(fontUrl, { method: "HEAD", signal: controller.signal });
    if (controller.signal.aborted) throw abortError(controller.signal);
    if (response.status === 405 || response.status === 501 || response.type === "opaque") {
      return {
        status: "unverified",
        fontUrl,
        message: `PDF 字体 ${JSON.stringify(fontUrl)} 无法通过 HEAD 检查验证；仍可尝试导出，届时会加载并校验字体`
      };
    }
    if (!response.ok) {
      const cause = new Error(`字体请求返回 HTTP ${response.status}`);
      return { status: "error", fontUrl, message: fontHint(fontUrl, cause.message), cause };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const cause = new Error("字体 URL 返回 HTML 页面（可能是 SPA 路由回退），不是字体文件");
      return { status: "error", fontUrl, message: fontHint(fontUrl, cause.message), cause };
    }
    if (/^text\//i.test(contentType) || /(?:\/|\+)json(?:\s*;|$)/i.test(contentType)) {
      const cause = new Error(`字体 URL 返回 ${contentType} 文本响应，不是字体文件`);
      return { status: "error", fontUrl, message: fontHint(fontUrl, cause.message), cause };
    }
    return {
      status: "available",
      fontUrl,
      message: "PDF 字体资源可达；文字覆盖范围将在实际导出时校验"
    };
  } catch (cause) {
    if (controller.signal.aborted && !timedOut) throw abortError(controller.signal);
    return {
      status: "error",
      fontUrl,
      message: fontHint(fontUrl, timedOut ? "字体检查超时，请检查网络或字体服务" : "字体检查失败，请检查网络、字体服务或跨域访问配置"),
      cause
    };
  } finally {
    clearTimeout(timeout);
  }
}

function checkDefaultFont(fontUrl: string, signal?: AbortSignal): Promise<PdfFontCheckResult> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  if (!fontUrl) {
    return Promise.resolve({ status: "disabled", fontUrl, message: "已停用自定义 PDF 字体；内置字体用于西文，其他文字会在导出时校验" });
  }
  const cached = availableFonts.get(fontUrl);
  if (cached) return Promise.resolve(cached);
  let flight = fontChecks.get(fontUrl);
  if (!flight) {
    const controller = new AbortController();
    flight = { controller, promise: checkFontResource(fontUrl, controller), subscribers: 0 };
    const current = flight;
    fontChecks.set(fontUrl, current);
    // 缓存成功检查；失败、无法验证及取消均允许后续重试。
    current.promise = current.promise.then((result) => {
      if (!controller.signal.aborted && result.status === "available") availableFonts.set(fontUrl, result);
      return result;
    }).finally(() => {
      if (fontChecks.get(fontUrl) === current) fontChecks.delete(fontUrl);
    });
  }
  const current = flight;
  current.subscribers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (): boolean => {
      if (finished) return false;
      finished = true;
      current.subscribers--;
      signal?.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = (): void => {
      if (!finish()) return;
      if (current.subscribers === 0) {
        if (fontChecks.get(fontUrl) === current) fontChecks.delete(fontUrl);
        current.controller.abort();
      }
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    current.promise.then(
      (result) => { if (finish()) resolve(result); },
      (cause: unknown) => { if (finish()) reject(cause); }
    );
    // 也处理注册监听器前同步发生的取消（例如宿主 fetch 包装器触发取消）。
    if (signal?.aborted) onAbort();
  });
}

/**
 * 默认 PDF 导出器：
 * - 懒加载 @agile-team/mach-report/pdf（含 pdf-lib，只在首次导出时进 bundle）
 * - 字体走 IndexedDB 持久缓存（loadFontWithCache，二次导出零网络）
 */
export function createDefaultPdfExporter(
  options: DefaultPdfExporterOptions = { fontUrl: "/simhei.ttf" }
): PdfExporter {
  let pdfModule: typeof import("@agile-team/mach-report/pdf") | null = null;
  const exporter: PdfExporter = async (plan, onWarning, task = {}) => {
    assertOutputActive(task.signal);
    if (!pdfModule) {
      pdfModule = await import("@agile-team/mach-report/pdf");
    }
    assertOutputActive(task.signal);
    const font = await requiredFont(options.fontUrl, pdfModule.loadFontWithCache, task.signal);
    let rendered: Awaited<ReturnType<typeof pdfModule.renderPlanToPdf>>;
    try {
      assertOutputActive(task.signal);
      rendered = await pdfModule.renderPlanToPdf(plan, { ...task, ...(font ? { customFontBytes: font } : {}) });
    } catch (cause) {
      if (!font) throw cause;
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw withCause(`PDF 生成失败：${detail}。当前字体 URL 为 ${JSON.stringify(options.fontUrl)}；请确认该文件是有效字体，或重新配置 pdfFontUrl`, cause);
    }
    assertOutputActive(task.signal);
    rendered.diagnostics?.forEach((entry) => { try { task.onDiagnostic?.(entry); } catch { /* Observer failure cannot fail output. */ } });
    const { bytes, unsupportedTextCount, pageErrors, fidelityWarnings } = rendered;
    if (unsupportedTextCount > 0) {
      throw new Error(`PDF 中有 ${unsupportedTextCount} 行文字无法编码；请部署支持所用文字的字体并配置 pdfFontUrl`);
    }
    if (pageErrors.length > 0) {
      throw new Error(`PDF 有 ${pageErrors.length} 页渲染失败：${pageErrors[0]}`);
    }
    if (fidelityWarnings.length > 0) {
      onWarning?.(`PDF 有 ${fidelityWarnings.length} 处版式降级：${fidelityWarnings.slice(0, 2).join("；")}`);
    }
    return bytes;
  };
  exporter.checkFont = (signal) => checkDefaultFont(options.fontUrl, signal);
  exporter.prepare = async (signal) => {
    assertOutputActive(signal);
    if (!options.fontUrl) return {};
    const { loadFontWithCache } = await import("../pdf/font-loader");
    const font = await requiredFont(options.fontUrl, loadFontWithCache, signal);
    return font ? { customFontBytes: font } : {};
  };
  return exporter;
}
