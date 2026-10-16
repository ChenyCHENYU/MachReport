import type { PlanPage } from "../schema/render-plan";
import { isImageBackedComponent } from "../schema/render-plan";

export type CanvasImageLoader = (source: string, signal?: AbortSignal) => Promise<CanvasImageSource>;

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/** Browser-only decoder. Remote URLs require an explicit, CORS-aware imageLoader adapter. */
export const loadCanvasImage: CanvasImageLoader = (source, signal) => {
  throwIfAborted(signal);
  if (!/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(source)) {
    return Promise.reject(new TypeError("Canvas imageData must be an image data URL; provide imageLoader for other sources."));
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error("Image could not be decoded for Canvas output.")); };
    signal?.addEventListener("abort", abort, { once: true });
    image.src = source;
  });
};

function loadWithAbort(loader: CanvasImageLoader, source: string, signal?: AbortSignal): Promise<CanvasImageSource> {
  throwIfAborted(signal);
  if (!signal) return loader(source);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => loader(source, signal)).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Page-scoped cache bounds decoded image residency to the page currently being drawn. */
export async function loadPageImages(page: PlanPage, loader: CanvasImageLoader, signal?: AbortSignal): Promise<Map<string, CanvasImageSource>> {
  const images = new Map<string, CanvasImageSource>();
  for (const component of page.components) {
    if (!isImageBackedComponent(component) || images.has(component.imageData!)) continue;
    images.set(component.imageData!, await loadWithAbort(loader, component.imageData!, signal));
  }
  throwIfAborted(signal);
  return images;
}

export function drawCanvasImage(ctx: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, width: number, height: number): void {
  const size = image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const sourceWidth = size.naturalWidth ?? size.width ?? width;
  const sourceHeight = size.naturalHeight ?? size.height ?? height;
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new RangeError("Decoded Canvas image dimensions must be positive.");
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}
