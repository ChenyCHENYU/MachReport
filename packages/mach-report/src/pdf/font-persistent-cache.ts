import { getFontCacheStats } from "./font-cache";
const DB_NAME = "mach-report-fonts", STORE = "fonts";
interface CachedFont { bytes: Uint8Array; accessedAt: number }
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
function cachedValue(value: unknown): CachedFont | undefined {
  if (value instanceof Uint8Array) return { bytes: value, accessedAt: 0 };
  const item = value as CachedFont | undefined;
  return item?.bytes instanceof Uint8Array && Number.isFinite(item.accessedAt) ? item : undefined;
}
async function withDatabase<T>(fallback: T, action: (db: IDBDatabase) => Promise<T>): Promise<T> {
  if (typeof indexedDB === "undefined") return fallback;
  let db: IDBDatabase | undefined;
  try { db = await openDb(); return await action(db); }
  catch { return fallback; }
  finally { db?.close(); }
}
export function readPersistentFont(key: string): Promise<Uint8Array | null> {
  return withDatabase(null, (db) => new Promise<Uint8Array | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), request = store.get(key);
    let value: Uint8Array | null = null;
    request.onsuccess = () => {
      const item = cachedValue(request.result);
      if (item && item.bytes.byteLength <= getFontCacheStats().maxFontBytes) { value = item.bytes; store.put({ bytes: item.bytes, accessedAt: Date.now() }, key); }
      else if (request.result !== undefined) store.delete(key);
    };
    tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }));
}
interface CachedFontEntry { key: IDBValidKey; bytes: number; accessedAt: number }
function pruneFonts(store: IDBObjectStore, entries: CachedFontEntry[], key: string, value: Uint8Array): void {
  const limits = getFontCacheStats(), all = entries.filter((entry) => entry.key !== key);
  store.delete(key);
  if (value.byteLength <= Math.min(limits.maxFontBytes, limits.maxBytes)) all.unshift({ key, bytes: value.byteLength, accessedAt: Date.now() });
  all.sort((a, b) => b.accessedAt - a.accessedAt);
  let bytes = 0, fonts = 0;
  for (const entry of all) {
    if (fonts >= limits.maxFonts || bytes + entry.bytes > limits.maxBytes || entry.bytes > limits.maxFontBytes) { store.delete(entry.key); continue; }
    bytes += entry.bytes; fonts++;
    if (entry.key === key) store.put({ bytes: value, accessedAt: entry.accessedAt }, key);
  }
}
export function writePersistentFont(key: string, bytes: Uint8Array): Promise<void> {
  return withDatabase(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), cursor = store.openCursor();
    const entries: CachedFontEntry[] = [];
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) { pruneFonts(store, entries, key, bytes); return; }
      const item = cachedValue(row.value); if (item) entries.push({ key: row.key, bytes: item.bytes.byteLength, accessedAt: item.accessedAt }); else row.delete();
      row.continue();
    };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }));
}
export function removePersistentFont(key?: string): Promise<void> {
  return withDatabase(undefined, (db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
    if (key === undefined) store.clear(); else store.delete(key);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }));
}
