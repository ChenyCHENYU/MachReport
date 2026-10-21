import { clearMemoryFonts, deleteMemoryFont, getFontCacheStats, getMemoryFont, putMemoryFont } from "./font-cache";
import { readPersistentFont, removePersistentFont, writePersistentFont } from "./font-persistent-cache";
export { configureFontCache, getFontCacheStats } from "./font-cache";
export type { FontCacheOptions, FontCacheStats } from "./font-cache";
let epoch = 0, activeLoads = 0;
let clearing = Promise.resolve();
const invalidations = new Map<string, Promise<void>>();
/** Invalidating or clearing also fences late downloads from repopulating the cache. */
export async function invalidateFontCache(url: string): Promise<void> {
  cacheVersions.set(url, (cacheVersions.get(url) ?? 0) + 1);
  deleteMemoryFont(url); inFlight.delete(url);
  const previous = invalidations.get(url);
  const task = (async () => { await clearing; await previous; await cacheWrites.get(url); await removePersistentFont(url); })();
  invalidations.set(url, task);
  try { await task; } finally { if (invalidations.get(url) === task) invalidations.delete(url); }
}
export async function clearFontCache(): Promise<void> {
  epoch++; clearMemoryFonts(); inFlight.clear(); cacheVersions.clear();
  const previous = clearing;
  const task = (async () => { await previous; await Promise.all(cacheWrites.values()); await removePersistentFont(); })();
  clearing = task.catch(() => undefined); await task;
}
const cacheVersions = new Map<string, number>();
const cacheWrites = new Map<string, Promise<void>>();
interface FontData {
  bytes: Uint8Array;
  fromCache: boolean;
}
/** 并发去重：同一 URL 的并行加载共享同一个 Promise，避免大字体重复拉取 */
const inFlight = new Map<string, Promise<FontData>>();
const pendingLoads = new Set<Promise<FontData>>();
function releaseGenerations(): void { if (!activeLoads && !pendingLoads.size) cacheVersions.clear(); }
const fontValidations = new WeakMap<Uint8Array, Promise<void>>();

export interface FontLoadOptions {
  /** 校验字体格式与可解析结构，失败抛出带 cause 的诊断；默认保留旧 API 的 null 降级。 */
  strict?: boolean;
  /** Cancels this subscriber without aborting another subscriber sharing the same URL. */
  signal?: AbortSignal;
}

function isHtml(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 256));
  return /^\s*(?:\uFEFF)?\s*<(?:!doctype\s+html|html|head|body)(?:\s|>)/i.test(prefix);
}

function validateBytes(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new Error("字体文件为空");
  if (isHtml(bytes)) throw new Error("字体 URL 返回 HTML 页面（可能是 SPA 路由回退），不是字体文件");
}

function validateFont(bytes: Uint8Array): Promise<void> {
  const pending = fontValidations.get(bytes);
  if (pending) return pending;
  const task = (async () => {
    const signature = String.fromCharCode(...bytes.subarray(0, 4));
    if (!["\u0000\u0001\u0000\u0000", "true", "OTTO", "wOFF", "wOF2", "ttcf"].includes(signature)) {
      throw new Error("文件内容不是支持的 TTF/OTF/WOFF 字体（可能返回了 JSON 或文本）");
    }
    // 仅严格加载时使用现有 PDF 字体依赖；HEAD 检查不会进入此路径。
    const { default: fontkit } = await import("@pdf-lib/fontkit");
    const font = fontkit.create(bytes);
    if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0 || !font.characterSet?.length || !font.numGlyphs) {
      throw new Error("字体结构无效或不含可嵌入的单字体；请提供有效的 TTF/OTF/WOFF 文件");
    }
  })();
  fontValidations.set(bytes, task);
  return task;
}

function fontLoadError(url: string, cause: unknown, timedOut = false): Error & { cause: unknown } {
  const detail = timedOut
    ? "字体加载超时，请检查网络或字体服务"
    : cause instanceof Error ? cause.message : String(cause);
  return Object.assign(new Error(`PDF 字体 ${JSON.stringify(url)} 加载失败：${detail}`), { cause });
}

function checkFontSize(bytes: number, maxBytes: number): void {
  if (bytes > maxBytes) throw new Error(`字体文件超过单字体下载预算（${maxBytes}字节）`);
}
async function responseFontBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(response.headers?.get("content-length"));
  try { if (Number.isFinite(declared)) checkFontSize(declared, maxBytes); }
  catch (error) { void response.body?.cancel(error).catch(() => undefined); throw error; }
  if (!response.body) {
    const bytes = new Uint8Array(await waitForFont(response.arrayBuffer(), signal)); checkFontSize(bytes.byteLength, maxBytes); return bytes;
  }
  return readFontStream(response.body, maxBytes, signal);
}
async function readFontStream(stream: ReadableStream<Uint8Array>, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await waitForFont(reader.read(), signal); if (item.done) break;
      length += item.value.byteLength; checkFontSize(length, maxBytes); chunks.push(item.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) { void reader.cancel(error).catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}
async function decodeFontBytes(bytes: Uint8Array, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  // fetch 已按 Content-Encoding 解压时直接复用真实字体；也支持普通静态服务器原样返回 .gz 文件。
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream === "undefined") throw new Error("当前环境不支持 gzip 字体解压，请使用未压缩的字体 URL 或支持 DecompressionStream 的浏览器 / Node 环境");
  const compressed = new ReadableStream<BufferSource>({ start(controller) { controller.enqueue(bytes as BufferSource); controller.close(); } });
  const decoded = compressed.pipeThrough(new DecompressionStream("gzip"));
  // 压缩包与解压结果使用同一上限；读流时即可拒绝膨胀包，超时也覆盖解压等待。
  return readFontStream(decoded, maxBytes, signal);
}
async function fetchFontData(url: string): Promise<FontData> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  try {
    // 中文字体体积大（~9MB）；慢网 15s 超时，严格模式保留可操作的失败诊断。
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`字体请求返回 HTTP ${res.status}`);
    if (/text\/html|application\/xhtml\+xml/i.test(res.headers?.get("content-type") ?? "")) {
      throw new Error("字体 URL 返回 HTML 页面（可能是 SPA 路由回退），不是字体文件");
    }
    const maxBytes = getFontCacheStats().maxFontBytes;
    const downloaded = await responseFontBytes(res, maxBytes, controller.signal);
    const bytes = await decodeFontBytes(downloaded, maxBytes, controller.signal);
    validateBytes(bytes);
    return { bytes, fromCache: false };
  } catch (cause) {
    controller.abort();
    throw fontLoadError(url, cause, timedOut);
  } finally {
    clearTimeout(timeout);
  }
}

async function readFontData(url: string): Promise<FontData> {
  await clearing; await invalidations.get(url);
  const cached = await readPersistentFont(url);
  if (cached) {
    try {
      validateBytes(cached);
      return { bytes: cached, fromCache: true };
    } catch {
      // 忽略旧版本写入的空响应或 HTML 缓存，重新获取真实字体。
    }
  }
  return fetchFontData(url);
}

function sharedFontLoad(url: string): Promise<FontData> {
  const pending = inFlight.get(url);
  if (pending) return pending;
  const task = readFontData(url);
  inFlight.set(url, task); pendingLoads.add(task);
  const release = () => { if (inFlight.get(url) === task) inFlight.delete(url); pendingLoads.delete(task); releaseGenerations(); };
  void task.then(release, release);
  return task;
}

async function storeFontBytes(url: string, bytes: Uint8Array, cacheVersion: number, loadEpoch: number): Promise<void> {
  if ((cacheVersions.get(url) ?? 0) !== cacheVersion || epoch !== loadEpoch) return;
  putMemoryFont(url, bytes);
  const pending = cacheWrites.get(url); if (pending) { await pending; return; }
  // 等待写入结束，后续失效操作不会被尚未完成的写入覆盖。
  const writing = writePersistentFont(url, bytes);
  cacheWrites.set(url, writing);
  await writing;
  if (cacheWrites.get(url) === writing) cacheWrites.delete(url);
}

function abortReason(signal: AbortSignal): unknown { return signal.reason ?? new DOMException("字体加载已取消", "AbortError"); }
function waitForFont<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(abortReason(signal)); };
    signal.addEventListener("abort", abort, { once: true });
    void task.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
async function validateLoadedFont(url: string, data: FontData, options: FontLoadOptions, cacheVersion: number, loadEpoch: number): Promise<Uint8Array> {
  try { await waitForFont(validateFont(data.bytes), options.signal); return data.bytes; }
  catch (cause) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    // Stale validation failures must not invalidate a repaired generation.
    if ((cacheVersions.get(url) ?? 0) !== cacheVersion || epoch !== loadEpoch) throw fontLoadError(url, cause);
    await invalidateFontCache(url);
    if (data.fromCache) return (await loadFontWithCache(url, options))!;
    throw fontLoadError(url, cause);
  }
}
/**
 * 字体加载（浏览器：IndexedDB 持久缓存 + 内存缓存；Node/SSR：内存缓存 + fetch）：
 * 中文字体体积大（simhei ~9MB），首次 fetch 后缓存，后续导出零网络等待。
 * 双环境兼容——同一引擎可在 Node 做无头导出（定时任务/归档）。
 */
export async function loadFontWithCache(url: string, options: FontLoadOptions = {}): Promise<Uint8Array | null> {
  if (options.signal?.aborted) throw abortReason(options.signal);
  const cacheVersion = cacheVersions.get(url) ?? 0, loadEpoch = epoch;
  const memo = getMemoryFont(url);
  if (memo && !options.strict) return memo;
  const task = memo ? undefined : sharedFontLoad(url);
  activeLoads++;
  try {
    const data = memo ? { bytes: memo, fromCache: true } : await waitForFont(task!, options.signal);
    const bytes = options.strict ? await validateLoadedFont(url, data, options, cacheVersion, loadEpoch) : data.bytes;
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (!memo) await waitForFont(storeFontBytes(url, bytes, cacheVersion, loadEpoch), options.signal);
    return bytes;
  } catch (cause) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (options.strict) throw cause;
    return null;
  } finally {
    activeLoads--;
    releaseGenerations();
  }
}
