import { portableSha256HexAsync } from "./sha256";
import { ReportJobError, serializeJobJson, type ReportJobRecord, type ReportJobRequest, type ReportJobStatus } from "./job-store";

export interface ReportJobTombstone {
  scope: string; id: string; revision: number; status: Exclude<ReportJobStatus, "queued" | "running">;
  createdAt: number; updatedAt: number; attempt: number; requestHash: string; expiresAt: number;
}
export interface ReportJobPruneOptions { now: number; terminalBefore: number; tombstoneRetentionMs?: number; limit?: number }
export interface ReportJobPruneResult { archived: number; expired: number }
export interface ReportJobStoreBudgetOptions {
  maxRecords?: number; maxBytes?: number; maxResultBytes?: number; controlReserveBytes?: number;
  maxTombstones?: number; maxTombstoneBytes?: number;
}
export function jobStoreBudget(options: ReportJobStoreBudgetOptions = {}) {
  const budget = { maxRecords: options.maxRecords ?? 10_000, maxBytes: options.maxBytes ?? 64 * 1024 * 1024,
    maxResultBytes: options.maxResultBytes ?? 256 * 1024, controlReserveBytes: options.controlReserveBytes ?? 4096,
    maxTombstones: options.maxTombstones ?? 10_000, maxTombstoneBytes: options.maxTombstoneBytes ?? 16 * 1024 * 1024 };
  if (!Object.values(budget).every((value) => Number.isSafeInteger(value) && value > 0) || budget.controlReserveBytes < 4096) throw new ReportJobError("input", "任务容量应为正整数，控制状态预留至少4096字节");
  return budget;
}
export function jobByteLength(value: unknown): number { return new TextEncoder().encode(serializeJobJson(value)).byteLength; }
/** Reserve ordinary lease, cancellation, progress and bounded-error growth before accepting work. */
export function jobChargedBytes(record: ReportJobRecord, budget: ReturnType<typeof jobStoreBudget>): number {
  const base: ReportJobRecord = { scope: record.scope, id: record.id, revision: 1, request: record.request, status: "queued", createdAt: record.createdAt, updatedAt: record.createdAt, attempt: 0 };
  const control = { ...record }; delete control.result;
  const resultBytes = record.result === undefined ? 0 : jobByteLength(record.result);
  if (resultBytes > budget.maxResultBytes) throw new ReportJobError("capacity", "任务结果超过独立预算，请保存文件引用");
  return Math.max(jobByteLength(base) + budget.controlReserveBytes, jobByteLength(control)) + resultBytes;
}
export function terminalJob(record: ReportJobRecord): boolean { return record.status !== "queued" && record.status !== "running"; }
export function pruneSettings(options: ReportJobPruneOptions) {
  const settings = { ...options, tombstoneRetentionMs: options.tombstoneRetentionMs ?? 7 * 24 * 60 * 60 * 1000, limit: options.limit ?? 100 };
  if (![settings.now, settings.terminalBefore].every((value) => Number.isSafeInteger(value) && value >= 0) || settings.terminalBefore > settings.now) throw new ReportJobError("input", "终态清理时间应为不超过当前时间的非负整数");
  if (![settings.tombstoneRetentionMs, settings.limit].every((value) => Number.isSafeInteger(value) && value > 0) || !Number.isSafeInteger(settings.now + settings.tombstoneRetentionMs)) throw new ReportJobError("input", "幂等保留期与清理批量应为正整数");
  return settings;
}
export async function jobRequestHash(request: ReportJobRequest): Promise<string> {
  const bytes = new TextEncoder().encode(serializeJobJson(request));
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return portableSha256HexAsync(bytes);
  const hash = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (item) => item.toString(16).padStart(2, "0")).join("");
}
export async function archiveJob(record: ReportJobRecord, expiresAt: number): Promise<ReportJobTombstone> {
  if (!terminalJob(record)) throw new ReportJobError("input", "只能归档终态任务");
  return { scope: record.scope, id: record.id, revision: record.revision, status: record.status as ReportJobTombstone["status"], createdAt: record.createdAt, updatedAt: record.updatedAt, attempt: record.attempt, requestHash: await jobRequestHash(record.request), expiresAt };
}
export function validateJobTombstone(value: ReportJobTombstone): void {
  if (!value || !["completed", "failed", "cancelled"].includes(value.status) || !/^[a-f0-9]{64}$/.test(value.requestHash)) throw new ReportJobError("input", "任务幂等摘要无效");
  if (![value.revision, value.createdAt, value.updatedAt, value.attempt, value.expiresAt].every((item) => Number.isSafeInteger(item) && item >= 0) || value.revision < 1) throw new ReportJobError("input", "任务幂等摘要时间或修订无效");
}
