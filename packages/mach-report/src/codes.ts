import { encode } from "fast-png";
import type { ComponentImageRenderer } from "./output/assets";
import type { PlanComponent } from "./schema/render-plan";
import { resolveCode, resolveCodeImageOptions, type ResolvedCode } from "./codes/options";
import { rasterCode } from "./codes/raster";
import { checkCodeAbort, CodeImageError, type CodeImageOptions } from "./codes/types";

export { CodeImageError, type CodeImageErrorCode, type CodeImageOptions } from "./codes/types";
export type { CodeOptions } from "./schema/code-options";

function pngDataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return `data:image/png;base64,${btoa(binary)}`;
}

async function encodeImage(code: ResolvedCode, signal?: AbortSignal): Promise<string> {
  checkCodeAbort(signal);
  await Promise.resolve();
  checkCodeAbort(signal);
  const raster = rasterCode(code, signal);
  let image: string;
  try { image = pngDataUrl(encode({ ...raster, channels: 1, depth: 8 })); }
  catch (cause) { throw new CodeImageError("encode-failed", "PNG encoding failed.", "image", cause); }
  checkCodeAbort(signal);
  return image;
}

/** Cross-platform PNG output. It uses no DOM, Canvas, Buffer, network or platform font service. */
export async function renderCodeImage(component: Readonly<PlanComponent>, options: CodeImageOptions = {}, signal?: AbortSignal): Promise<string> {
  checkCodeAbort(signal);
  const config = resolveCodeImageOptions(options);
  return encodeImage(resolveCode(component, config), signal);
}

/** Plug into assets.assetRenderers. Its bounded LRU stores successful images only. */
export function createCodeAssetRenderers(options: CodeImageOptions = {}): { barcode: ComponentImageRenderer; qrcode: ComponentImageRenderer } {
  const config = resolveCodeImageOptions(options), cache = new Map<string, { image: string; bytes: number }>();
  let retained = 0;
  const render: ComponentImageRenderer = async ({ component, signal }) => {
    checkCodeAbort(signal);
    const code = resolveCode(component, config), key = JSON.stringify(code), cached = cache.get(key);
    if (cached) { cache.delete(key); cache.set(key, cached); await Promise.resolve(); checkCodeAbort(signal); return cached.image; }
    const image = await encodeImage(code, signal), bytes = (key.length + image.length) * 2;
    checkCodeAbort(signal);
    if (config.maxCacheEntries > 0 && bytes <= config.maxCacheBytes) {
      const previous = cache.get(key);
      if (previous) { retained -= previous.bytes; cache.delete(key); }
      while (cache.size >= config.maxCacheEntries || retained + bytes > config.maxCacheBytes) {
        const first = cache.keys().next().value!;
        retained -= cache.get(first)!.bytes; cache.delete(first);
      }
      cache.set(key, { image, bytes }); retained += bytes;
    }
    return image;
  };
  return { barcode: render, qrcode: render };
}
