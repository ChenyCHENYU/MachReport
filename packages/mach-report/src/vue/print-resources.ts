import { assertOutputActive, forwardOutputAbort, waitForOutput } from "../output/progress";
import type { ReportPrintMessages, ReportPrintOptions } from "./print-options";
import { DEFAULT_PRINT_MESSAGES } from "./print-options";

export class ReportPrintResourceError extends Error {
  readonly code = "print-resource";
  constructor(readonly kind: "image" | "font" | "timeout" | "config", readonly resource: string | number = "") {
    super(`Print preparation failed: ${kind} ${resource}`); this.name = "ReportPrintResourceError";
  }
}
export function printResourceMessage(error: unknown, messages?: ReportPrintMessages): string {
  const m = { ...DEFAULT_PRINT_MESSAGES, ...messages };
  if (!(error instanceof ReportPrintResourceError)) return m.printPrepareFailed;
  if (error.kind === "timeout") return m.printPrepareTimeout;
  if (error.kind === "image") return m.printImageFailed.replace("{index}", String(error.resource));
  if (error.kind === "font") return m.printFontFailed.replace("{family}", String(error.resource));
  return m.printPrepareFailed;
}

function fontSource(source: string, base: string): string {
  let url: URL;
  try { url = new URL(source, base); } catch { throw new ReportPrintResourceError("config"); }
  if (!["http:", "https:"].includes(url.protocol) || source.length > 16384) throw new ReportPrintResourceError("config");
  return url.href;
}
async function prepareFonts(doc: Document, options: ReportPrintOptions, signal: AbortSignal, base: string): Promise<void> {
  const fonts = options.fonts ?? [];
  if (fonts.length > 8) throw new ReportPrintResourceError("config");
  for (const font of fonts) {
    assertOutputActive(signal);
    if (typeof font.family !== "string" || !font.family.trim() || font.family.length > 256 || typeof font.source !== "string") throw new ReportPrintResourceError("config");
    const Font = doc.defaultView?.FontFace;
    if (!Font || !doc.fonts) throw new ReportPrintResourceError("font", font.family);
    try {
      // Reuse the bounded font download/decompression cache; FontFace validates
      // the actual print face without loading the PDF renderer or fontkit.
      const { loadFontWithCache } = await import("../pdf/font-loader");
      const bytes = await loadFontWithCache(fontSource(font.source, base), { signal });
      if (!bytes) throw new ReportPrintResourceError("font", font.family);
      const face = new Font(font.family, bytes as Uint8Array<ArrayBuffer>, { weight: font.weight, style: font.style });
      await waitForOutput(face.load(), signal); doc.fonts.add(face);
    }
    catch (error) { assertOutputActive(signal); throw error instanceof ReportPrintResourceError ? error : new ReportPrintResourceError("font", font.family); }
  }
  // Trigger layout first: the print document owns a different FontFaceSet from its parent.
  doc.documentElement.getBoundingClientRect();
  if (doc.fonts) await waitForOutput(doc.fonts.ready, signal);
}

async function prepareImage(image: HTMLImageElement, index: number, signal: AbortSignal): Promise<void> {
  assertOutputActive(signal);
  try {
    if (typeof image.decode === "function") await waitForOutput(image.decode(), signal);
    else if (!image.complete) await new Promise<void>((resolve, reject) => {
      const clean = () => { image.removeEventListener("load", loaded); image.removeEventListener("error", failed); signal.removeEventListener("abort", aborted); };
      const loaded = () => { clean(); resolve(); };
      const failed = () => { clean(); reject(new ReportPrintResourceError("image", index)); };
      const aborted = () => { clean(); reject(signal.reason); };
      image.addEventListener("load", loaded, { once: true }); image.addEventListener("error", failed, { once: true }); signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted(); else if (image.complete) loaded();
    });
    assertOutputActive(signal);
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new ReportPrintResourceError("image", index);
  } catch { assertOutputActive(signal); throw new ReportPrintResourceError("image", index); }
}

/** Bounded concurrency, one stage timeout, and cancellation even for a hanging decoder. */
export async function preparePrintResources(doc: Document, options: ReportPrintOptions = {}, signal?: AbortSignal, base = document.baseURI): Promise<void> {
  const timeout = options.resourceTimeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000) throw new ReportPrintResourceError("config");
  const controller = new AbortController(), detach = forwardOutputAbort(signal, controller);
  const timer = setTimeout(() => controller.abort(new ReportPrintResourceError("timeout")), timeout);
  try {
    assertOutputActive(controller.signal);
    await prepareFonts(doc, options, controller.signal, base);
    const images = doc.querySelectorAll<HTMLImageElement>("img");
    let cursor = 0;
    const worker = async () => {
      while (cursor < images.length) { const index = cursor++; await prepareImage(images[index]!, index + 1, controller.signal); }
    };
    await Promise.all(Array.from({ length: Math.min(images.length, 4) }, worker));
    assertOutputActive(controller.signal);
  } finally { clearTimeout(timer); detach(); controller.abort(); }
}
