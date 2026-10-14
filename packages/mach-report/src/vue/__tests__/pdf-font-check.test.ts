// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderPlan } from "@agile-team/mach-report";
import type { PdfExporter, PdfFontCheckResult } from "../pdf-exporter";

const pdf = vi.hoisted(() => ({
  imports: 0,
  loadFont: vi.fn(),
  render: vi.fn()
}));

vi.mock("@agile-team/mach-report/pdf", () => {
  pdf.imports++;
  return { loadFontWithCache: pdf.loadFont, renderPlanToPdf: pdf.render };
});

let createDefaultPdfExporter: typeof import("../pdf-exporter")["createDefaultPdfExporter"];
const plan: RenderPlan = { schemaVersion: "font-check", pages: [] };

beforeEach(async () => {
  vi.resetModules();
  pdf.imports = 0;
  pdf.loadFont.mockReset();
  pdf.render.mockReset();
  createDefaultPdfExporter = (await import("../pdf-exporter")).createDefaultPdfExporter;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function check(exporter: PdfExporter, signal?: AbortSignal): Promise<PdfFontCheckResult> {
  return exporter.checkFont!(signal);
}

describe("默认 PDF 字体首次检查", () => {
  it("只 HEAD 检查可达性，不读字体正文或加载 PDF 模块", async () => {
    const response = new Response(null, { headers: { "content-type": "font/ttf" } });
    const readBody = vi.spyOn(response, "arrayBuffer");
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const result = await check(createDefaultPdfExporter({ fontUrl: "/fonts/chinese.ttf" }));
    expect(result).toMatchObject({ status: "available", fontUrl: "/fonts/chinese.ttf" });
    expect(result.message).toContain("实际导出时校验");
    expect(fetchMock).toHaveBeenCalledWith("/fonts/chinese.ttf", { method: "HEAD", signal: expect.any(AbortSignal) });
    expect(readBody).not.toHaveBeenCalled();
    expect(pdf.imports).toBe(0);
    expect(pdf.loadFont).not.toHaveBeenCalled();
    expect(pdf.render).not.toHaveBeenCalled();
  });

  it("旧默认 URL 保持兼容，404 提示配置 pdfFontUrl 和部署字体", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const result = await check(createDefaultPdfExporter());
    expect(result).toMatchObject({ status: "error", fontUrl: "/simhei.ttf", cause: expect.any(Error) });
    expect(result.message).toContain("HTTP 404");
    expect(result.message).toContain("/simhei.ttf");
    expect(result.message).toContain("部署");
    expect(result.message).toContain("pdfFontUrl");
    expect(pdf.imports).toBe(0);
  });

  it.each(["text/html; charset=utf-8", "application/xhtml+xml"])("拒绝 SPA 的 %s 响应", async (contentType) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { headers: { "content-type": contentType } })));
    const result = await check(createDefaultPdfExporter({ fontUrl: "/missing.ttf" }));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/HTML.*SPA/);
    expect(pdf.imports).toBe(0);
  });

  it.each(["application/json", "application/problem+json; charset=utf-8", "text/plain", "text/javascript"])("拒绝明确的 %s 文本响应", async (contentType) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { headers: { "content-type": contentType } })));
    const result = await check(createDefaultPdfExporter({ fontUrl: "/error-response.ttf" }));
    expect(result).toMatchObject({ status: "error", cause: expect.any(Error), message: expect.stringContaining("不是字体文件") });
    expect(pdf.imports).toBe(0);
  });

  it.each(["application/octet-stream", ""])("%s MIME 仍仅报告资源可达", async (contentType) => {
    const headers = contentType ? { "content-type": contentType } : undefined;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { headers })));
    expect(await check(createDefaultPdfExporter({ fontUrl: "/binary.ttf" }))).toMatchObject({ status: "available" });
    expect(pdf.imports).toBe(0);
  });

  it.each([405, 501])("HEAD 返回 %i 时不能验证，仍可尝试导出且允许重新检查", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const exporter = createDefaultPdfExporter({ fontUrl: "/no-head.ttf" });
    expect(await check(exporter)).toMatchObject({ status: "unverified", message: expect.stringContaining("仍可尝试导出") });
    await check(exporter);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pdf.imports).toBe(0);
  });

  it("空 URL 明确停用，不调用网络或 PDF 模块", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await check(createDefaultPdfExporter({ fontUrl: "" }))).toMatchObject({ status: "disabled", fontUrl: "" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pdf.imports).toBe(0);
  });

  it("保留网络错误 cause，失败后同 URL 可重试", async () => {
    const cause = new TypeError("Failed to fetch");
    const fetchMock = vi.fn().mockRejectedValueOnce(cause).mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);
    const exporter = createDefaultPdfExporter({ fontUrl: "/retry.ttf" });
    expect(await check(exporter)).toMatchObject({ status: "error", cause, message: expect.stringContaining("跨域") });
    expect(await check(exporter)).toMatchObject({ status: "available" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("不同 exporter 同 URL 并发去重，成功检查缓存按 URL 复用", async () => {
    let complete!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const first = createDefaultPdfExporter({ fontUrl: "/shared.ttf" });
    const second = createDefaultPdfExporter({ fontUrl: "/shared.ttf" });
    const checks = [check(first), check(second)];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    complete(new Response(null));
    expect(await Promise.all(checks)).toEqual([expect.objectContaining({ status: "available" }), expect.objectContaining({ status: "available" })]);
    await check(createDefaultPdfExporter({ fontUrl: "/shared.ttf" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(new Response(null));
    await check(createDefaultPdfExporter({ fontUrl: "/another.ttf" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("已经取消的检查拒绝 AbortError，不发送 HEAD", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(check(createDefaultPdfExporter(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("取消单个共享订阅不影响其他调用，并移除监听器", async () => {
    let complete!: (value: Response) => void;
    let underlyingSignal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      underlyingSignal = init.signal!;
      return new Promise<Response>((resolve) => { complete = resolve; });
    }));
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const exporter = createDefaultPdfExporter({ fontUrl: "/shared-abort.ttf" });
    const cancelled = check(exporter, controller.signal);
    const survivor = check(exporter);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(underlyingSignal.aborted).toBe(false);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    complete(new Response(null));
    expect(await survivor).toMatchObject({ status: "available" });
  });

  it("全部订阅取消时终止请求、清理超时，随后可重试", async () => {
    vi.useFakeTimers();
    let underlyingSignal!: AbortSignal;
    const fetchMock = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => {
      underlyingSignal = init.signal!;
      return new Promise<Response>((_resolve, reject) => {
        underlyingSignal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }).mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const exporter = createDefaultPdfExporter({ fontUrl: "/all-abort.ttf" });
    const cancelled = check(exporter, controller.signal);
    const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(underlyingSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(await check(exporter)).toMatchObject({ status: "available" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("慢请求超时返回可重试错误，完成时释放计时器与外部监听器", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })).mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const exporter = createDefaultPdfExporter({ fontUrl: "/timeout.ttf" });
    const pending = check(exporter, controller.signal);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await pending).toMatchObject({ status: "error", message: expect.stringContaining("超时") });
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(await check(exporter)).toMatchObject({ status: "available" });
  });
});

describe("字体检查与实际导出兼容", () => {
  it("旧自定义函数无需 checkFont，仍可作为 PdfExporter 调用", async () => {
    const exporter: PdfExporter = async () => new Uint8Array([37, 80, 68, 70]);
    expect(exporter.checkFont).toBeUndefined();
    expect(await exporter(plan)).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it("实际导出要求严格加载，失败保留 cause 与可操作的 URL 诊断", async () => {
    const cause = new Error("字体请求返回 HTTP 404");
    pdf.loadFont.mockRejectedValue(cause);
    const exporter = createDefaultPdfExporter({ fontUrl: "/exports.ttf" });
    await expect(exporter(plan)).rejects.toMatchObject({ cause, message: expect.stringMatching(/\/exports\.ttf.*404.*pdfFontUrl/) });
    expect(pdf.loadFont).toHaveBeenCalledWith("/exports.ttf", { strict: true });
    expect(pdf.render).not.toHaveBeenCalled();
  });

  it("加载后的损坏字体无法生成 PDF 时保留底层 cause 与配置提示", async () => {
    const cause = new Error("Unknown font format");
    pdf.loadFont.mockResolvedValue(new Uint8Array([1, 2, 3]));
    pdf.render.mockRejectedValue(cause);
    await expect(createDefaultPdfExporter({ fontUrl: "/broken.ttf" })(plan)).rejects.toMatchObject({
      cause,
      message: expect.stringMatching(/Unknown font format.*\/broken\.ttf.*pdfFontUrl/)
    });
  });

  it.each([null, new Uint8Array()])("字体实际加载为空时停止导出（%s）", async (font) => {
    pdf.loadFont.mockResolvedValue(font);
    await expect(createDefaultPdfExporter({ fontUrl: "/empty.ttf" })(plan)).rejects.toThrow(/字体.*为空.*pdfFontUrl/);
    expect(pdf.render).not.toHaveBeenCalled();
  });

  it("资源可达不绕过实际文字编码校验", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
    pdf.loadFont.mockResolvedValue(new Uint8Array([1, 2, 3]));
    pdf.render.mockResolvedValue({ bytes: new Uint8Array(), unsupportedTextCount: 1, pageErrors: [], fidelityWarnings: [] });
    const exporter = createDefaultPdfExporter({ fontUrl: "/limited.ttf" });
    expect(await check(exporter)).toMatchObject({ status: "available" });
    await expect(exporter(plan)).rejects.toThrow(/无法编码.*pdfFontUrl/);
  });
});
