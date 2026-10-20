import { archiveJob, jobByteLength, jobChargedBytes, jobStoreBudget, pruneSettings, terminalJob, type ReportJobPruneOptions, type ReportJobPruneResult, type ReportJobStoreBudgetOptions, type ReportJobTombstone } from "./job-retention";
export type { ReportJobPruneOptions, ReportJobPruneResult, ReportJobStoreBudgetOptions, ReportJobTombstone } from "./job-retention";
export type ReportJobJson = null | boolean | number | string | ReportJobJson[] | { [key: string]: ReportJobJson };
export type ReportJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export interface ReportJobRequest { kind: string; payload: ReportJobJson }
export interface ReportJobRecord {
  scope: string; id: string; revision: number; request: ReportJobRequest; status: ReportJobStatus;
  createdAt: number; updatedAt: number; attempt: number;
  lease?: { owner: string; expiresAt: number };
  cancelRequested?: boolean;
  progress?: { completed: number; total?: number };
  result?: ReportJobJson;
  /** Idempotent submit after terminal archival; result/error payloads are no longer retained. */
  archived?: boolean;
  error?: { code: string; message: string };
}
/** CAS must be atomic across all worker instances; candidate enumeration is advisory only. */
export interface ReportJobStore {
  read(scope: string, id: string): Promise<ReportJobRecord | undefined>;
  candidates(now: number, limit: number): Promise<ReportJobRecord[]>;
  /** Optional bounded retention capability; existing database adapters remain compatible. */
  readTombstone?(scope: string, id: string): Promise<ReportJobTombstone | undefined>;
  prune?(options: ReportJobPruneOptions): Promise<ReportJobPruneResult>;
  compareAndSwap(scope: string, id: string, expectedRevision: number | null, next: ReportJobRecord): Promise<boolean>;
}
export class ReportJobError extends Error {
  constructor(readonly code: "input" | "conflict" | "missing" | "lease" | "closed" | "capacity", message: string) { super(message); this.name = "ReportJobError"; }
}
export function checkJobIdentity(scope: string, id: string): void {
  if (typeof scope !== "string" || !scope.trim() || scope.length > 256 || typeof id !== "string" || id !== id.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(id)) throw new ReportJobError("input", "任务范围应非空，ID应为1–128位安全标识");
}
function containerKeys(item: object): string[] {
  const array = Array.isArray(item), prototype = Object.getPrototypeOf(item), keys = Object.keys(item);
  if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) throw new ReportJobError("input", "任务对象应为普通 JSON 对象");
  if (Object.getOwnPropertySymbols(item).length) throw new ReportJobError("input", "任务不能包含Symbol");
  const names = Object.getOwnPropertyNames(item).filter((key) => !(array && key === "length"));
  if (names.length !== keys.length) throw new ReportJobError("input", "任务不能包含不可枚举属性");
  if (array && (keys.length !== item.length || keys.some((key) => key !== String(Number(key)) || !Number.isSafeInteger(Number(key)) || Number(key) < 0 || Number(key) >= item.length))) throw new ReportJobError("input", "任务数组不能稀疏或包含额外属性");
  return keys.sort();
}
function propertyValue(item: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
  if (["__proto__", "prototype", "constructor"].includes(key) || descriptor.get || descriptor.set) throw new ReportJobError("input", "任务不能包含危险键或访问器");
  return descriptor.value;
}
/** Canonical plain JSON rejects getters/scripts and gives stable idempotency without coercion. */
export function serializeJobJson(value: unknown, budget: { maxNodes?: number; maxCharacters?: number } = {}): string {
  const maxNodes = budget.maxNodes ?? 20_000, maxCharacters = budget.maxCharacters ?? 1_000_000;
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 20_000 || !Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 1_000_000) throw new ReportJobError("input", "任务JSON预算无效");
  let nodes = 0, characters = 0;
  const ancestors = new Set<object>();
  function visit(item: unknown, depth: number): ReportJobJson {
    if (++nodes > maxNodes || depth > 32) throw new ReportJobError("input", "任务数据超过节点或深度预算");
    if (typeof item === "string") { characters += item.length; if (characters > maxCharacters) throw new ReportJobError("input", "任务文本超过预算"); return item; }
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return item;
    if (!item || typeof item !== "object" || ancestors.has(item)) throw new ReportJobError("input", "任务只允许无循环的有限 JSON 值");
    const array = Array.isArray(item), keys = containerKeys(item);
    ancestors.add(item);
    const result: Record<string, ReportJobJson> = Object.create(null);
    for (const key of keys) {
      characters += key.length;
      if (characters > maxCharacters) throw new ReportJobError("input", "任务文本超过预算");
      result[key] = visit(propertyValue(item, key), depth + 1);
    }
    ancestors.delete(item);
    if (array) return Array.from({ length: item.length }, (_, index) => result[String(index)]!);
    return result;
  }
  const result = JSON.stringify(visit(value, 0));
  if (result.length > maxCharacters) throw new ReportJobError("input", "任务序列化数据超过字符预算");
  return result;
}
export function cloneJob<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function validateJobRecord(record: ReportJobRecord, scope: string, id: string, expectedRevision: number | null): void {
  checkJobIdentity(scope, id);
  if (record.scope !== scope || record.id !== id || record.revision !== (expectedRevision ?? 0) + 1 || !Number.isSafeInteger(record.revision)) throw new ReportJobError("input", "任务身份或修订不匹配");
  if (![record.createdAt, record.updatedAt, record.attempt].every((value) => Number.isSafeInteger(value) && value >= 0) || !["queued", "running", "completed", "failed", "cancelled"].includes(record.status)) throw new ReportJobError("input", "任务状态无效");
  if (record.lease && (!record.lease.owner || !Number.isSafeInteger(record.lease.expiresAt))) throw new ReportJobError("input", "任务租约无效");
  if (!record.request || typeof record.request.kind !== "string" || !record.request.kind.trim() || record.request.kind.length > 128) throw new ReportJobError("input", "任务类型无效");
  serializeJobJson(record.request.payload, { maxNodes: 19_000, maxCharacters: 750_000 });
  serializeJobJson(record);
}
export function validateJobTransition(previous: ReportJobRecord | undefined, next: ReportJobRecord): void {
  if (previous && (previous.createdAt !== next.createdAt || serializeJobJson(previous.request) !== serializeJobJson(next.request))) throw new ReportJobError("input", "任务创建时间与请求不可变更，请使用新任务ID");
}
export function runnableJob(record: ReportJobRecord, now: number): boolean { return record.status === "queued" || record.status === "running" && (record.lease?.expiresAt ?? 0) <= now; }

/** Reference store for tests; use a database CAS or the single-process durable Node adapter in production. */
export function createMemoryReportJobStore(options: ReportJobStoreBudgetOptions = {}): ReportJobStore {
  const records = new Map<string, ReportJobRecord>(), tombstones = new Map<string, ReportJobTombstone>(), budget = jobStoreBudget(options);
  let bytes = 0, tombstoneBytes = 0, pending = Promise.resolve();
  const key = (scope: string, id: string) => JSON.stringify([scope, id]);
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => { const task = pending.then(operation); pending = task.then(() => undefined, () => undefined); return task; };
  return {
    read: async (scope, id) => { await pending; const record = records.get(key(scope, id)); return record ? cloneJob(record) : undefined; },
    readTombstone: async (scope, id) => { await pending; const value = tombstones.get(key(scope, id)); return value ? cloneJob(value) : undefined; },
    candidates: async (now, limit) => { await pending; return Array.from(records.values()).filter((record) => runnableJob(record, now)).sort((a, b) => a.createdAt - b.createdAt).slice(0, limit).map(cloneJob); },
    compareAndSwap: async (scope, id, revision, next) => {
      validateJobRecord(next, scope, id, revision);
      const snapshot = cloneJob(next);
      return enqueue(async () => {
        const identity = key(scope, id), previous = records.get(identity);
        if ((previous?.revision ?? null) !== revision || tombstones.has(identity)) return false;
        validateJobTransition(previous, snapshot);
        const total = bytes - (previous ? jobChargedBytes(previous, budget) : 0) + jobChargedBytes(snapshot, budget);
        if (total > budget.maxBytes || !previous && records.size >= budget.maxRecords) throw new ReportJobError("capacity", "任务容量已满，请清理终态任务或扩大显式预算");
        records.set(identity, snapshot); bytes = total; return true;
      });
    },
    prune: async (options) => {
      const settings = pruneSettings(options);
      return enqueue(async () => {
        const result = { archived: 0, expired: 0 };
        for (const [identity, value] of tombstones) {
          if (value.expiresAt > settings.now || result.expired >= settings.limit) continue;
          tombstones.delete(identity); tombstoneBytes -= jobByteLength(value); result.expired++;
        }
        for (const [identity, record] of records) {
          if (!terminalJob(record) || record.updatedAt > settings.terminalBefore || result.archived + result.expired >= settings.limit) continue;
          const value = await archiveJob(record, settings.now + settings.tombstoneRetentionMs), size = jobByteLength(value);
          if (tombstones.size >= budget.maxTombstones || tombstoneBytes + size > budget.maxTombstoneBytes) break;
          tombstones.set(identity, value); tombstoneBytes += size;
          records.delete(identity); bytes -= jobChargedBytes(record, budget); result.archived++;
        }
        return result;
      });
    }
  };
}
