import type { PlanPage } from "../schema/render-plan";
import type { ReportDocumentManifest } from "../server/document-store";
import type { ReportDocumentSource, ReportDocumentWindow } from "../server/document-source";
import { assertOutputActive, waitForOutput } from "../output/progress";
import { cloneReportSnapshot } from "./snapshot";
import { DOCUMENT_CACHE_BYTES, DOCUMENT_CACHE_PAGES, DOCUMENT_WINDOW_LIMIT, documentInputError, snapshotDocumentWindow } from "./document-window-validation";

interface PendingWindow { controller: AbortController; promise: Promise<ReportDocumentWindow>; users: number }
/** One owned preview session: bounded LRU, pinned identity, shared reads, independent subscriber cancellation. */
export function createDocumentWindowReader(source: ReportDocumentSource) {
  const cache = new Map<number, { page: PlanPage; bytes: number }>();
  const pending = new Map<number, PendingWindow>();
  let manifest: ReportDocumentManifest | undefined, cacheBytes = 0, epoch = 0, disposed = false;
  function retain(index: number, page: PlanPage): void {
    const bytes = new TextEncoder().encode(JSON.stringify(page)).byteLength;
    const previous = cache.get(index); if (previous) cacheBytes -= previous.bytes;
    cache.delete(index); cache.set(index, { page, bytes }); cacheBytes += bytes;
    while (cache.size > DOCUMENT_CACHE_PAGES || cacheBytes > DOCUMENT_CACHE_BYTES) {
      const first = cache.keys().next().value!; cacheBytes -= cache.get(first)!.bytes; cache.delete(first);
    }
  }
  function request(fromPage: number): PendingWindow {
    const existing = pending.get(fromPage); if (existing) return existing;
    const controller = new AbortController(), started = epoch;
    const input = { fromPage, limit: DOCUMENT_WINDOW_LIMIT, version: manifest?.version, signal: controller.signal };
    const task: PendingWindow = { controller, users: 0, promise: waitForOutput(Promise.resolve().then(() => { assertOutputActive(controller.signal); return source.load({ ...input }); }), controller.signal).then(value => {
      assertOutputActive(controller.signal);
      if (started !== epoch) throw documentInputError("文档加载已被替换");
      const result = snapshotDocumentWindow(value, input, manifest);
      manifest = result.manifest;
      result.pages.forEach((page, offset) => retain(fromPage + offset, page));
      return result;
    }).finally(() => { if (pending.get(fromPage) === task) pending.delete(fromPage); }) };
    pending.set(fromPage, task); return task;
  }
  async function load(index: number, signal?: AbortSignal): Promise<{ manifest: ReportDocumentManifest; page?: PlanPage }> {
    assertOutputActive(signal);
    if (disposed || !Number.isSafeInteger(index) || index < 0 || index >= 100_000) throw documentInputError("文档页索引无效或预览已关闭");
    const hit = cache.get(index);
    if (hit && manifest) { cache.delete(index); cache.set(index, hit); return cloneReportSnapshot({ manifest, page: hit.page }); }
    const from = index;
    const task = request(from); task.users++;
    try {
      const result = await waitForOutput(task.promise, signal); assertOutputActive(signal);
      if (index >= result.manifest.pageCount && (result.manifest.pageCount > 0 || index > 0)) throw documentInputError("页码超出文档范围");
      const page = result.pages[index - from];
      if (!page && index < result.manifest.pageCount) throw documentInputError("目标页未返回，请缩小页窗口");
      return cloneReportSnapshot({ manifest: result.manifest, ...(page ? { page } : {}) });
    } finally {
      if (--task.users === 0 && pending.get(from) === task) { pending.delete(from); task.controller.abort(); }
    }
  }
  function reset(): void {
    epoch++; for (const task of pending.values()) task.controller.abort(); pending.clear(); cache.clear(); cacheBytes = 0; manifest = undefined;
  }
  return { load, reset, dispose: () => { reset(); disposed = true; }, get cachedPages() { return cache.size; }, get cachedBytes() { return cacheBytes; } };
}
