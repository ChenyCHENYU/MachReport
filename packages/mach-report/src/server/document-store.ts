import { RENDER_PLAN_SCHEMA_VERSION, type PlanPage, type RenderPlan } from "../schema/render-plan";
import { validateRenderPlan } from "../schema/validate";
import { snapshotReportJson } from "../schema/json-snapshot";
import { controlled, throwIfAborted } from "./control";
import type { PreparedReport } from "./types";
import { validatePreparedMetadata } from "./prepared";

export interface ReportDocumentManifest {
  scope: string; id: string; version: string;
  /** CAS token increases after each append and completion. */
  revision: number;
  state: "building" | "complete" | "failed";
  failure?: { code: "cancelled" | "generation"; message: string };
  pageCount: number;
  bytes: number;
  plan: Omit<RenderPlan, "pages">;
  metadata?: Omit<PreparedReport, "plan">;
}
export interface ReportDocumentBudget {
  maxDocuments?: number; maxBytes?: number; maxPages?: number; maxPageBytes?: number; maxManifestBytes?: number;
}
export interface ReportDocumentStore {
  create(input: Pick<ReportDocumentManifest, "scope" | "id" | "version" | "plan">, signal?: AbortSignal): Promise<ReportDocumentManifest>;
  append(scope: string, id: string, version: string, expectedRevision: number, page: PlanPage, signal?: AbortSignal): Promise<ReportDocumentManifest>;
  complete(scope: string, id: string, version: string, expectedRevision: number, metadata?: Omit<PreparedReport, "plan">, signal?: AbortSignal): Promise<ReportDocumentManifest>;
  fail(scope: string, id: string, version: string, expectedRevision: number, failure: NonNullable<ReportDocumentManifest["failure"]>): Promise<ReportDocumentManifest>;
  read(scope: string, id: string, signal?: AbortSignal): Promise<ReportDocumentManifest | undefined>;
  readPage(scope: string, id: string, version: string, index: number, signal?: AbortSignal): Promise<PlanPage | undefined>;
  remove(scope: string, id: string, version: string, signal?: AbortSignal): Promise<boolean>;
}
export class ReportDocumentError extends Error {
  constructor(readonly code: "input" | "capacity" | "conflict" | "missing" | "closed", message: string) { super(message); this.name = "ReportDocumentError"; }
}
export function documentBudget(input: ReportDocumentBudget = {}): Required<ReportDocumentBudget> {
  const budget = { maxDocuments: input.maxDocuments ?? 32, maxBytes: input.maxBytes ?? 64_000_000, maxPages: input.maxPages ?? 10_000, maxPageBytes: input.maxPageBytes ?? 4_000_000, maxManifestBytes: input.maxManifestBytes ?? 1_000_000 };
  if (Object.values(budget).some(value => !Number.isSafeInteger(value) || value < 1)) throw new ReportDocumentError("input", "文档预算应为正安全整数");
  return budget;
}
export function documentIdentity(scope: string, id: string, version?: string): string {
  if ([scope, id, ...(version === undefined ? [] : [version])].some(value => typeof value !== "string" || !value.trim() || value.length > 256)) throw new ReportDocumentError("input", "文档 scope、id、version 应为 1–256 位非空字符串");
  return JSON.stringify([scope, id]);
}
export function documentSnapshot<T>(value: T, maxBytes: number, signal?: AbortSignal): T {
  return snapshotReportJson(value, { maxBytes, maxNodes: maxBytes, check: () => throwIfAborted(signal), error: (code, message) => new ReportDocumentError(code === "budget" ? "capacity" : "input", message) });
}
export function documentBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function validateDocumentPlan(plan: Omit<RenderPlan, "pages">): void {
  if (!plan || plan.schemaVersion !== RENDER_PLAN_SCHEMA_VERSION || "pages" in plan || plan.requiresRecalculation !== undefined && typeof plan.requiresRecalculation !== "boolean") throw new ReportDocumentError("input", "文档计划头应使用当前版本，且不得携带 pages");
}
function chargeManifest(next: ReportDocumentManifest, pageBytes: number): void {
  next.bytes = 0;
  for (let index = 0; index < 8; index++) {
    const charged = pageBytes + documentBytes(next);
    if (charged === next.bytes) return;
    next.bytes = charged;
  }
  throw new ReportDocumentError("capacity", "文档容量统计无效");
}
export interface ReportDocumentDriver {
  write(manifest: ReportDocumentManifest, page?: { index: number; value: PlanPage }): Promise<void>;
  readPage(scope: string, id: string, index: number): Promise<PlanPage | undefined>;
  remove(manifest: ReportDocumentManifest): Promise<void>;
}
/** Internal adapter core: serializes mutations, snapshots before awaits, never holds file-backed pages. */
export function createDocumentStoreDriver(driver: ReportDocumentDriver, budget: Required<ReportDocumentBudget>, loaded: ReportDocumentManifest[] = []): ReportDocumentStore {
  const records = new Map<string, ReportDocumentManifest>(); let totalBytes = 0, pending = Promise.resolve();
  for (const value of loaded) {
    const key = documentIdentity(value.scope, value.id, value.version);
    validateDocumentPlan(value.plan);
    if (records.has(key) || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || !Number.isSafeInteger(value.pageCount) || value.pageCount < 0 || value.pageCount > budget.maxPages || !["building", "complete", "failed"].includes(value.state) || value.revision !== value.pageCount + (value.state === "building" ? 0 : 1)) throw new ReportDocumentError("input", "文档清单无效");
    records.set(key, documentSnapshot(value, budget.maxManifestBytes)); totalBytes += value.bytes;
  }
  function checkCapacity(next: ReportDocumentManifest, previous?: ReportDocumentManifest): void {
    if (totalBytes - (previous?.bytes ?? 0) + next.bytes > budget.maxBytes || !previous && records.size >= budget.maxDocuments) throw new ReportDocumentError("capacity", "文档存储容量已满，请显式清理旧文档");
  }
  if (records.size > budget.maxDocuments || totalBytes > budget.maxBytes) throw new ReportDocumentError("capacity", "已存文档超过预算");
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => { const task = pending.then(run); pending = task.then(() => undefined, () => undefined); return task; };
  const find = (scope: string, id: string, version: string, revision?: number): ReportDocumentManifest => {
    const value = records.get(documentIdentity(scope, id, version));
    if (!value) throw new ReportDocumentError("missing", "文档不存在");
    if (value.version !== version || revision !== undefined && value.revision !== revision) throw new ReportDocumentError("conflict", "文档已变化，请重新读取清单");
    return value;
  };
  const commit = async (next: ReportDocumentManifest, previous?: ReportDocumentManifest, page?: { index: number; value: PlanPage }) => {
    const snapshot = documentSnapshot(next, budget.maxManifestBytes); checkCapacity(snapshot, previous);
    await driver.write(snapshot, page);
    records.set(documentIdentity(next.scope, next.id), snapshot); totalBytes += next.bytes - (previous?.bytes ?? 0);
    return documentSnapshot(snapshot, budget.maxManifestBytes);
  };
  return {
    create: (input, signal) => {
      const value = documentSnapshot(input, budget.maxManifestBytes, signal), key = documentIdentity(value.scope, value.id, value.version);
      validateDocumentPlan(value.plan);
      return enqueue(async () => {
        throwIfAborted(signal);
        if (records.has(key)) throw new ReportDocumentError("conflict", "文档已存在，不可覆盖");
        const next: ReportDocumentManifest = { ...value, revision: 0, state: "building", pageCount: 0, bytes: 0 };
        chargeManifest(next, 0); return commit(next);
      });
    },
    append: (scope, id, version, revision, page, signal) => {
      const value = documentSnapshot(page, budget.maxPageBytes, signal);
      const result = validateRenderPlan({ pages: [value] });
      if (!result.ok) throw new ReportDocumentError("input", result.errors[0]!.message);
      return enqueue(async () => {
        throwIfAborted(signal); const previous = find(scope, id, version, revision);
        if (previous.state !== "building") throw new ReportDocumentError("conflict", "已完成文档不可追加");
        if (previous.pageCount >= budget.maxPages) throw new ReportDocumentError("capacity", "文档页数超过预算");
        const next = { ...previous, revision: revision + 1, pageCount: previous.pageCount + 1 };
        chargeManifest(next, previous.bytes - documentBytes(previous) + documentBytes(value));
        return commit(next, previous, { index: previous.pageCount, value });
      });
    },
    complete: (scope, id, version, revision, metadata, signal) => {
      const value = metadata === undefined ? undefined : documentSnapshot(metadata, budget.maxManifestBytes, signal);
      if (value) validatePreparedMetadata({ ...value, plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION, pages: [] } });
      return enqueue(async () => {
        throwIfAborted(signal); const previous = find(scope, id, version, revision);
        if (previous.state !== "building") throw new ReportDocumentError("conflict", "文档已完成");
        if (value && value.stats.pages !== previous.pageCount) throw new ReportDocumentError("input", "准备结果页数与文档页数不一致");
        const next = { ...previous, revision: revision + 1, state: "complete" as const, ...(value ? { metadata: value } : {}) };
        chargeManifest(next, previous.bytes - documentBytes(previous)); return commit(next, previous);
      });
    },
    fail: (scope, id, version, revision, failure) => {
      const value = documentSnapshot(failure, 4096);
      if (!value || !["cancelled", "generation"].includes(value.code) || typeof value.message !== "string" || !value.message.trim() || value.message.length > 1024) throw new ReportDocumentError("input", "文档失败状态无效");
      return enqueue(async () => {
        const previous = find(scope, id, version, revision);
        if (previous.state !== "building") throw new ReportDocumentError("conflict", "终态文档不可变更");
        const next = { ...previous, state: "failed" as const, revision: revision + 1, failure: value };
        chargeManifest(next, previous.bytes - documentBytes(previous)); return commit(next, previous);
      });
    },
    read: async (scope, id, signal) => { throwIfAborted(signal); const key = documentIdentity(scope, id); await pending; throwIfAborted(signal); const value = records.get(key); return value ? documentSnapshot(value, budget.maxManifestBytes) : undefined; },
    readPage: (scope, id, version, index, signal) => enqueue(async () => {
      throwIfAborted(signal); const manifest = find(scope, id, version);
      if (!Number.isSafeInteger(index) || index < 0) throw new ReportDocumentError("input", "页索引应为非负安全整数");
      if (index >= manifest.pageCount) return;
      const page = await driver.readPage(scope, id, index); throwIfAborted(signal);
      if (!page) throw new ReportDocumentError("missing", "已提交的文档页缺失");
      return documentSnapshot(page, budget.maxPageBytes, signal);
    }),
    remove: (scope, id, version, signal) => enqueue(async () => {
      throwIfAborted(signal); const key = documentIdentity(scope, id, version), previous = records.get(key);
      if (!previous) return false;
      find(scope, id, version); await driver.remove(previous); records.delete(key); totalBytes -= previous.bytes; return true;
    })
  };
}
/** Bounded, single-process reference store. Scope is host-authorized identity, never a client permission. */
export function createMemoryReportDocumentStore(options: ReportDocumentBudget = {}): ReportDocumentStore {
  const pages = new Map<string, PlanPage[]>();
  return createDocumentStoreDriver({
    write: async (manifest, page) => { if (!page) return; const key = documentIdentity(manifest.scope, manifest.id), list = pages.get(key) ?? []; list[page.index] = page.value; pages.set(key, list); },
    readPage: async (scope, id, index) => pages.get(documentIdentity(scope, id))?.[index],
    remove: async manifest => { pages.delete(documentIdentity(manifest.scope, manifest.id)); }
  }, documentBudget(options));
}

/** Progressive consumption ends at the currently committed boundary; caller may resume with nextPage. */
export async function readReportDocumentPages(store: ReportDocumentStore, input: {
  scope: string; id: string; version: string; fromPage?: number; limit?: number; maxBytes?: number; signal?: AbortSignal;
}): Promise<{ manifest: ReportDocumentManifest; pages: PlanPage[]; nextPage: number }> {
  const from = input.fromPage ?? 0, limit = input.limit ?? 4, maxBytes = input.maxBytes ?? 8_000_000;
  if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 32 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new ReportDocumentError("input", "页窗口参数无效；每次最多读取 32 页");
  const manifest = await store.read(input.scope, input.id, input.signal);
  if (!manifest) throw new ReportDocumentError("missing", "文档不存在");
  if (manifest.version !== input.version) throw new ReportDocumentError("conflict", "文档版本已变化");
  const pages: PlanPage[] = []; let bytes = 0, index = Math.min(from, manifest.pageCount);
  for (; index < Math.min(manifest.pageCount, from + limit); index++) {
    const page = await store.readPage(input.scope, input.id, input.version, index, input.signal);
    if (!page) throw new ReportDocumentError("missing", "文档页缺失");
    const size = documentBytes(page);
    if (bytes + size > maxBytes) { if (!pages.length) throw new ReportDocumentError("capacity", "单页超过读取窗口预算"); break; }
    pages.push(page); bytes += size;
  }
  return { manifest, pages, nextPage: index };
}

/** Accepts paginateTemplatePages/AsyncIterable without retaining all pages; partial documents stay inspectable on failure. */
export async function writeReportDocument(store: ReportDocumentStore, input: {
  scope: string; id: string; version: string; plan: Omit<RenderPlan, "pages">;
  pages: Iterable<PlanPage> | AsyncIterable<PlanPage>; metadata?: Omit<PreparedReport, "plan">; signal?: AbortSignal;
}): Promise<ReportDocumentManifest> {
  const { scope, id, version, signal, pages } = input;
  const metadata = input.metadata === undefined ? undefined : documentSnapshot(input.metadata, 1_000_000, signal);
  let manifest = await store.create({ scope, id, version, plan: input.plan }, signal);
  let iterator: Iterator<PlanPage> | AsyncIterator<PlanPage> | undefined;
  try {
    const producer = Symbol.asyncIterator in pages ? pages[Symbol.asyncIterator]() : pages[Symbol.iterator]();
    iterator = producer;
    for (;;) {
      const next = await controlled(signal, undefined, () => Promise.resolve(producer.next()));
      if (next.done) break;
      manifest = await store.append(scope, id, version, manifest.revision, next.value, signal);
    }
    return await store.complete(scope, id, version, manifest.revision, metadata, signal);
  } catch (error) {
    // An uncooperative producer must not delay cancellation; its late result cannot append a page.
    void Promise.resolve(iterator?.return?.()).catch(() => undefined);
    await store.fail(scope, id, version, manifest.revision, signal?.aborted
      ? { code: "cancelled", message: "报表文档生成已取消" }
      : { code: "generation", message: "报表文档生成失败" }).catch(() => undefined);
    throw error;
  }
}
