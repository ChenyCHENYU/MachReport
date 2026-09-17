const DB_NAME = "mach-report-fonts";
const STORE = "fonts";

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

/**
 * 字体加载（IndexedDB 持久缓存 + 内存缓存）：
 * 中文字体体积大（simhei ~9MB），首次 fetch 后缓存，后续导出零网络等待。
 */
export async function loadFontWithCache(url: string): Promise<Uint8Array | null> {
  const memo = memory.get(url);
  if (memo) return memo;
  const cached = await readCache(url);
  if (cached) {
    memory.set(url, cached);
    return cached;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    memory.set(url, bytes);
    void writeCache(url, bytes);
    return bytes;
  } catch {
    return null;
  }
}
