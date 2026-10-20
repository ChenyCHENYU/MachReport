export interface FontCacheOptions { maxFonts?: number; maxBytes?: number; maxFontBytes?: number }
export interface FontCacheStats { fonts: number; bytes: number; maxFonts: number; maxBytes: number; maxFontBytes: number }
const memory = new Map<string, Uint8Array>();
let bytes = 0;
let limits = { maxFonts: 8, maxBytes: 64 * 1024 * 1024, maxFontBytes: 24 * 1024 * 1024 };
function trim(): void {
  while (memory.size > limits.maxFonts || bytes > limits.maxBytes) {
    const key = memory.keys().next().value!; bytes -= memory.get(key)!.byteLength; memory.delete(key);
  }
}
/** Global optional cache tuning; fixed-font integrations use bounded defaults without configuration. */
export function configureFontCache(options: FontCacheOptions): void {
  const next = { ...limits, ...options };
  if (!Object.values(next).every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("字体缓存预算应为正整数字节/数量");
  limits = next;
  for (const [key, value] of memory) if (value.byteLength > limits.maxFontBytes) deleteMemoryFont(key);
  trim();
}
export function getFontCacheStats(): FontCacheStats { return { fonts: memory.size, bytes, ...limits }; }
export function getMemoryFont(key: string): Uint8Array | undefined {
  const value = memory.get(key);
  if (value) { memory.delete(key); memory.set(key, value); }
  return value;
}
export function deleteMemoryFont(key: string): void { const value = memory.get(key); if (value) bytes -= value.byteLength; memory.delete(key); }
export function clearMemoryFonts(): void { memory.clear(); bytes = 0; }
export function putMemoryFont(key: string, value: Uint8Array): void {
  deleteMemoryFont(key);
  if (value.byteLength > limits.maxBytes || value.byteLength > limits.maxFontBytes) return;
  memory.set(key, value); bytes += value.byteLength; trim();
}
