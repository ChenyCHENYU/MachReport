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
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeCache(key: string, bytes: Uint8Array): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(bytes, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 缓存写失败静默降级 */
  }
}

const memory = new Map<string, Uint8Array>();
/** 并发去重：同一 URL 的并行加载共享同一个 Promise，避免大字体重复拉取 */
const inFlight = new Map<string, Promise<Uint8Array | null>>();

/**
 * 字体加载（浏览器：IndexedDB 持久缓存 + 内存缓存；Node/SSR：内存缓存 + fetch）：
 * 中文字体体积大（simhei ~9MB），首次 fetch 后缓存，后续导出零网络等待。
 * 双环境兼容——同一引擎可在 Node 做无头导出（定时任务/归档）。
 */
export async function loadFontWithCache(url: string): Promise<Uint8Array | null> {
  const memo = memory.get(url);
  if (memo) return memo;
  const pending = inFlight.get(url);
  if (pending) return pending;
  const task = (async (): Promise<Uint8Array | null> => {
    const cached = await readCache(url);
    if (cached) {
      memory.set(url, cached);
      return cached;
    }
    try {
      // 中文字体体积大（~9MB），慢网防挂起：15s 超时后回退内置西文字体
      const signal =
        typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? AbortSignal.timeout(15_000)
          : undefined;
      const res = await fetch(url, signal ? { signal } : undefined);
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      memory.set(url, bytes);
      void writeCache(url, bytes);
      return bytes;
    } catch {
      return null;
    }
  })();
  inFlight.set(url, task);
  try {
    return await task;
  } finally {
    inFlight.delete(url);
  }
}
