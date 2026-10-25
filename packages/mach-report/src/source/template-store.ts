import { parseReportTemplate, type ReportTemplateDocument } from "./template-registry";
import type { ReportTemplateReview } from "./template-review";
import { createTemplateMigrator, type ReportTemplateMigration } from "./template-migrations";

export interface ReportTemplateVersion {
  revision: string;
  publishedAt: string;
  document: ReportTemplateDocument;
  restoredFrom?: string;
}
export interface ReportTemplateRecord {
  id: string;
  revision: string;
  draft?: ReportTemplateDocument;
  publishedRevision?: string;
  published?: ReportTemplateDocument;
}
export interface TemplateStoreWriteOptions { publication?: ReportTemplateVersion; signal?: AbortSignal }
/** compareAndSwap 必须由宿主数据库/文件适配器保证原子性，不能用先读再无条件写替代。 */
export interface ReportTemplateStore {
  read(id: string, signal?: AbortSignal): Promise<ReportTemplateRecord | undefined>;
  list(signal?: AbortSignal): Promise<Array<{ id: string; revision: string; publishedRevision?: string }>>;
  history(id: string, signal?: AbortSignal): Promise<ReportTemplateVersion[]>;
  getVersion(id: string, revision: string, signal?: AbortSignal): Promise<ReportTemplateVersion | undefined>;
  /** 状态更新和 publication 的不可变追加必须处于同一原子事务；草稿写入不读取历史。 */
  compareAndSwap(id: string, expectedRevision: string | null, next: ReportTemplateRecord, options: TemplateStoreWriteOptions): Promise<boolean>;
}
export interface TemplateMutationOptions { expectedRevision: string | null; signal?: AbortSignal }
export class ReportTemplateStoreError extends Error {
  constructor(readonly code: "conflict" | "missing" | "draft" | "history" | "review", message: string) {
    super(message); this.name = "ReportTemplateStoreError";
  }
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function checkAbort(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("模板操作已取消"); error.name = "AbortError"; throw error;
}
function nextRevision(record?: ReportTemplateRecord): string {
  // 管理器生成递增 token；适配器只做相等比较，不把它与数据库主键混为一谈。
  const previous = record ? Number(record.revision) : 0;
  if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) throw new ReportTemplateStoreError("history", "修订号无效或已达上限");
  return String(previous + 1);
}

export interface ReportTemplateManager {
  list(signal?: AbortSignal): ReturnType<ReportTemplateStore["list"]>;
  get(id: string, options?: { draft?: boolean; signal?: AbortSignal }): Promise<ReportTemplateDocument | undefined>;
  history(id: string, signal?: AbortSignal): Promise<readonly ReportTemplateVersion[]>;
  saveDraft(input: unknown, options: TemplateMutationOptions): Promise<ReportTemplateRecord>;
  publish(id: string, options: TemplateMutationOptions): Promise<ReportTemplateRecord>;
  rollback(id: string, revision: string, options: TemplateMutationOptions): Promise<ReportTemplateRecord>;
}

/** 持久化和框架无关的发布流程；历史返回快照，回滚会产生新修订而不会覆盖旧历史。 */
export function createTemplateManager(store: ReportTemplateStore, options: {
  migrate?: (input: unknown) => unknown | Promise<unknown>;
  /** Explicit schema chain, applied to saved drafts and loaded/rolled-back documents. Legacy migrate remains save-only. */
  migrations?: readonly ReportTemplateMigration[];
  now?: () => Date;
  /** Optional publication gate; receives explicit draft snapshots and never replaces CAS. */
  beforePublish?: (context: { document: ReportTemplateDocument; previous?: ReportTemplateDocument; signal?: AbortSignal }) => ReportTemplateReview | Promise<ReportTemplateReview>;
} = {}): ReportTemplateManager {
  const migrator = options.migrations ? createTemplateMigrator(options.migrations) : undefined;
  const documentSnapshot = async (input: unknown) => migrator ? (await migrator(input)).document : parseReportTemplate(input);
  const read = async (id: string, signal?: AbortSignal) => {
    checkAbort(signal); const result = await store.read(id, signal); checkAbort(signal);
    return result ? clone(result) : undefined;
  };
  const expected = async (id: string, mutation: TemplateMutationOptions) => {
    const record = await read(id, mutation.signal);
    if ((record?.revision ?? null) !== mutation.expectedRevision) throw new ReportTemplateStoreError("conflict", "模板已变化，请重新读取后提交");
    return record;
  };
  const commit = async (next: ReportTemplateRecord, mutation: TemplateMutationOptions, publication?: ReportTemplateVersion) => {
    checkAbort(mutation.signal);
    const written = await store.compareAndSwap(next.id, mutation.expectedRevision, clone(next), { signal: mutation.signal, ...(publication ? { publication: clone(publication) } : {}) });
    if (!written) throw new ReportTemplateStoreError("conflict", "模板已被其他请求更新");
    // CAS 成功后不再报告取消，否则调用方会误以为提交未发生。
    return clone(next);
  };
  const publish = async (record: ReportTemplateRecord, document: ReportTemplateDocument, mutation: TemplateMutationOptions, restoredFrom?: string): Promise<ReportTemplateRecord> => {
    if (options.beforePublish) {
      checkAbort(mutation.signal);
      const previous = record.published ? await documentSnapshot(record.published) : undefined;
      checkAbort(mutation.signal);
      const review = await options.beforePublish({ document: parseReportTemplate(document), previous, signal: mutation.signal });
      if (!review || review.ok !== true) throw new ReportTemplateStoreError("review", review?.issues?.find((issue) => issue.severity === "error")?.message ?? "模板发布检查未通过");
      checkAbort(mutation.signal);
    }
    const revision = nextRevision(record);
    const snapshot = parseReportTemplate({ ...document, revision });
    const entry: ReportTemplateVersion = { revision, document: snapshot, publishedAt: (options.now?.() ?? new Date()).toISOString() };
    if (restoredFrom !== undefined) entry.restoredFrom = restoredFrom;
    return commit({ id: record.id, revision, publishedRevision: revision, published: snapshot }, mutation, entry);
  };
  return {
    list: async (signal) => { checkAbort(signal); const rows = await store.list(signal); checkAbort(signal); return clone(rows); },
    get: async (id, request = {}) => {
      const record = await read(id, request.signal);
      const document = request.draft ? record?.draft : record?.published;
      const snapshot = document ? await documentSnapshot(document) : undefined;
      checkAbort(request.signal); return snapshot;
    },
    history: async (id, signal) => { checkAbort(signal); const history = await store.history(id, signal); checkAbort(signal); return clone(history); },
    saveDraft: async (input, mutation) => {
      mutation = { ...mutation };
      checkAbort(mutation.signal);
      const document = await documentSnapshot(options.migrate ? await options.migrate(input) : input);
      const record = await expected(document.id, mutation);
      const revision = nextRevision(record);
      return commit({ id: document.id, revision, draft: { ...document, revision },
        ...(record?.publishedRevision ? { publishedRevision: record.publishedRevision, published: record.published } : {}) }, mutation);
    },
    publish: async (id, mutation) => {
      mutation = { ...mutation };
      const record = await expected(id, mutation);
      if (!record) throw new ReportTemplateStoreError("missing", "模板不存在");
      if (!record.draft) throw new ReportTemplateStoreError("draft", "没有可发布的草稿");
      return publish(record, await documentSnapshot(record.draft), mutation);
    },
    rollback: async (id, revision, mutation) => {
      mutation = { ...mutation };
      const record = await expected(id, mutation);
      if (!record) throw new ReportTemplateStoreError("missing", "模板不存在");
      checkAbort(mutation.signal);
      const entry = await store.getVersion(id, revision, mutation.signal);
      if (!entry) throw new ReportTemplateStoreError("history", "历史修订不存在");
      return publish(record, await documentSnapshot(entry.document), mutation, revision);
    }
  };
}

/** 单进程参考适配器；多实例服务请实现具备数据库事务/CAS 的持久化适配器。 */
export function createMemoryTemplateStore(): ReportTemplateStore {
  const records = new Map<string, ReportTemplateRecord>();
  const versions = new Map<string, Map<string, ReportTemplateVersion>>();
  return {
    read: async (id, signal) => { checkAbort(signal); const record = records.get(id); return record ? clone(record) : undefined; },
    list: async (signal) => {
      checkAbort(signal);
      return Array.from(records.values(), ({ id, revision, publishedRevision }) => ({ id, revision, ...(publishedRevision ? { publishedRevision } : {}) }));
    },
    history: async (id, signal) => { checkAbort(signal); return Array.from(versions.get(id)?.values() ?? [], (version) => clone(version)); },
    getVersion: async (id, revision, signal) => { checkAbort(signal); const version = versions.get(id)?.get(revision); return version ? clone(version) : undefined; },
    compareAndSwap: async (id, revision, next, request) => {
      checkAbort(request.signal);
      if ((records.get(id)?.revision ?? null) !== revision) return false;
      if (next.id !== id) throw new ReportTemplateStoreError("history", "状态 ID 与存储 ID 不一致");
      const snapshot = clone(next);
      const publication = request.publication;
      if (publication) {
        const history = versions.get(id) ?? new Map<string, ReportTemplateVersion>();
        if (history.has(publication.revision) || publication.revision !== next.revision || publication.document.id !== id) throw new ReportTemplateStoreError("history", "发布修订不可覆盖，且必须与状态修订和模板 ID 一致");
        history.set(publication.revision, clone(publication)); versions.set(id, history);
      }
      records.set(id, snapshot); return true;
    }
  };
}
