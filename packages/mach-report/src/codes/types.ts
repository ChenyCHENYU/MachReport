export interface CodeImageOptions {
  /** PNG raster resolution, default 300; independent of the preview zoom. */
  dpi?: number;
  /** UTF-8 payload budget, default 2048 bytes (linear symbols also cap at 256 characters). */
  maxTextBytes?: number;
  /** Raster allocation budget, default 4,000,000 grayscale pixels. */
  maxPixels?: number;
  /** Maximum width/height, default 4096 pixels. */
  maxDimensionPx?: number;
  /** Per-renderer successful-image LRU, default 64 entries; 0 disables caching. */
  maxCacheEntries?: number;
  /** Approximate retained UTF-16 key/data-URL bytes, default 8 MiB; 0 disables caching. */
  maxCacheBytes?: number;
}

export type CodeImageErrorCode = "invalid-input" | "unsupported-format" | "capacity" | "encode-failed";

/** Stable failure category and field path, without echoing business payloads. */
export class CodeImageError extends Error {
  readonly code: CodeImageErrorCode;
  readonly path?: string;
  readonly cause: unknown;
  constructor(code: CodeImageErrorCode, message: string, path?: string, cause?: unknown) {
    super(message);
    this.name = "CodeImageError";
    this.code = code;
    this.path = path;
    this.cause = cause;
  }
}

export function checkCodeAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Code generation was aborted.", "AbortError");
}

export function codeInput(condition: boolean, message: string, path: string): asserts condition {
  if (!condition) throw new CodeImageError("invalid-input", message, path);
}
