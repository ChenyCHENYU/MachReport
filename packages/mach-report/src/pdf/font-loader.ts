const DB_NAME = "mach-report-fonts";
const STORE = "fonts";

/** Node 无头导出通道：无 IndexedDB 的宿主（Node/SSR）自动降级为仅内存缓存 */
const hasIdb = (): boolean => typeof indexedDB !== "undefined";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCache(key: string): Promise<Uint8Array | null> {
  if (!hasIdb()) return null;
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db!.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function writeCache(key: string, bytes: Uint8Array): Promise<void> {
  if (!hasIdb()) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(bytes, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 缓存写失败静默降级 */
  } finally {
    db?.close();
  }
}

/** 删除已知无效的字体缓存；供字体解析失败后修正同 URL 并重试。 */
export async function invalidateFontCache(url: string): Promise<void> {
  cacheVersions.set(url, (cacheVersions.get(url) ?? 0) + 1);
  memory.delete(url);
  inFlight.delete(url);
  await cacheWrites.get(url);
  if (!hasIdb()) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 持久缓存不可用时，仍清除内存缓存。 */
  } finally {
    db?.close();
  }
}

const memory = new Map<string, Uint8Array>();
const cacheVersions = new Map<string, number>();
const cacheWrites = new Map<string, Promise<void>>();
interface FontData {
  bytes: Uint8Array;
  fromCache: boolean;
}
/** 并发去重：同一 URL 的并行加载共享同一个 Promise，避免大字体重复拉取 */
const inFlight = new Map<string, Promise<FontData>>();
const fontValidations = new WeakMap<Uint8Array, Promise<void>>();

export interface FontLoadOptions {
  /** 校验字体格式与可解析结构，失败抛出带 cause 的诊断；默认保留旧 API 的 null 降级。 */
  strict?: boolean;
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

async function fetchFontData(url: string): Promise<FontData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    // 中文字体体积大（~9MB）；慢网 15s 超时，严格模式保留可操作的失败诊断。
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`字体请求返回 HTTP ${res.status}`);
    if (/text\/html|application\/xhtml\+xml/i.test(res.headers?.get("content-type") ?? "")) {
      throw new Error("字体 URL 返回 HTML 页面（可能是 SPA 路由回退），不是字体文件");
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    validateBytes(bytes);
    return { bytes, fromCache: false };
  } catch (cause) {
    throw fontLoadError(url, cause, controller.signal.aborted);
  } finally {
    clearTimeout(timeout);
  }
}

async function readFontData(url: string): Promise<FontData> {
  const cached = await readCache(url);
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
  inFlight.set(url, task);
  return task;
}

async function storeFontBytes(url: string, bytes: Uint8Array, cacheVersion: number): Promise<void> {
  if ((cacheVersions.get(url) ?? 0) !== cacheVersion) return;
  memory.set(url, bytes);
  // 等待写入结束，后续失效操作不会被尚未完成的写入覆盖。
  const writing = writeCache(url, bytes);
  cacheWrites.set(url, writing);
  await writing;
  if (cacheWrites.get(url) === writing) cacheWrites.delete(url);
}

/**
 * 字体加载（浏览器：IndexedDB 持久缓存 + 内存缓存；Node/SSR：内存缓存 + fetch）：
 * 中文字体体积大（simhei ~9MB），首次 fetch 后缓存，后续导出零网络等待。
 * 双环境兼容——同一引擎可在 Node 做无头导出（定时任务/归档）。
 */
export async function loadFontWithCache(url: string, options: FontLoadOptions = {}): Promise<Uint8Array | null> {
  const cacheVersion = cacheVersions.get(url) ?? 0;
  const memo = memory.get(url);
  if (memo && !options.strict) return memo;
  const task = memo ? inFlight.get(url) : sharedFontLoad(url);
  try {
    const data = memo ? { bytes: memo, fromCache: true } : await task!;
    if (options.strict) {
      try {
        await validateFont(data.bytes);
      } catch (cause) {
        // 过期请求只报告自身错误，不能移除已经修复的新代际缓存。
        if ((cacheVersions.get(url) ?? 0) !== cacheVersion) throw fontLoadError(url, cause);
        await invalidateFontCache(url);
        if (data.fromCache) {
          // 清理旧版本或宽松调用写入的坏缓存，直接重新获取同 URL。
          if (inFlight.get(url) === task) inFlight.delete(url);
          return await loadFontWithCache(url, options);
        }
        throw fontLoadError(url, cause);
      }
    }
    if (!memo) await storeFontBytes(url, data.bytes, cacheVersion);
    return data.bytes;
  } catch (cause) {
    if (options.strict) throw cause;
    return null;
  } finally {
    if (inFlight.get(url) === task) inFlight.delete(url);
  }
}
