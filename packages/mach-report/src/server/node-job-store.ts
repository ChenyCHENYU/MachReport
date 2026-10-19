import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { checkJobIdentity, cloneJob, ReportJobError, runnableJob, serializeJobJson, validateJobRecord, validateJobTransition, type ReportJobRecord, type ReportJobStore } from "./job-store";

export interface FileReportJobStore extends ReportJobStore { close(): Promise<void> }
export interface FileReportJobStoreOptions { directory: string; maxRecords?: number; maxBytes?: number; recoverDeadOwner?: boolean }
function errorCode(error: unknown): string | undefined { return (error as NodeJS.ErrnoException)?.code; }
function fileName(scope: string, id: string): string { return createHash("sha256").update(JSON.stringify([scope, id])).digest("hex") + ".json"; }
async function readOptional(file: string): Promise<string | undefined> {
  try { return await fs.readFile(file, "utf8"); } catch (error) { if (errorCode(error) === "ENOENT") return; throw error; }
}
async function recoverLock(file: string, recover: boolean): Promise<void> {
  if (!recover) throw new ReportJobError("conflict", "任务目录已有写入进程；多实例请使用数据库CAS适配器");
  const text = await readOptional(file);
  if (text === undefined) return;
  let owner: { pid?: number };
  try { owner = JSON.parse(text) as { pid?: number }; }
  catch { throw new ReportJobError("conflict", "任务锁尚未完整写入或已损坏，拒绝自动移除"); }
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid! < 1) throw new ReportJobError("conflict", "任务锁身份无效，拒绝自动移除");
  try { process.kill(owner.pid!, 0); } catch (error) {
    if (errorCode(error) === "ESRCH") { await fs.unlink(file); return; }
    throw error;
  }
  throw new ReportJobError("conflict", "任务目录的写入进程仍在运行");
}
async function recoverWriter(file: string, recover: boolean): Promise<FileHandle> {
  if (!recover) throw new ReportJobError("conflict", "任务目录已有写入进程；多实例请使用数据库CAS适配器");
  const recoveryFile = file + ".recovery";
  let guard: FileHandle;
  try { guard = await fs.open(recoveryFile, "wx", 0o600); }
  catch (error) { if (errorCode(error) === "EEXIST") throw new ReportJobError("conflict", "任务目录恢复正在进行，请稍后重试"); throw error; }
  try {
    await guard.writeFile(JSON.stringify({ pid: process.pid }));
    await recoverLock(file, true);
    return await fs.open(file, "wx", 0o600);
  } finally { await guard.close(); await fs.unlink(recoveryFile); }
}
async function lockDirectory(directory: string, recover: boolean): Promise<{ file: string; token: string; handle: FileHandle }> {
  const file = path.join(directory, ".writer-lock"), token = randomUUID();
  let handle: FileHandle;
  try { handle = await fs.open(file, "wx", 0o600); }
  catch (error) { if (errorCode(error) !== "EEXIST") throw error; handle = await recoverWriter(file, recover); }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync(); }
  catch (error) { await handle.close(); await fs.unlink(file).catch(() => undefined); throw error; }
  return { file, token, handle };
}
async function loadRecords(directory: string, maxRecords: number, maxBytes: number) {
  const entries = await fs.readdir(directory);
  // Exclusive writer lock is already held: these are uncommitted remnants from a crashed writer.
  for (const file of entries.filter((name) => /^\.pending-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(name))) await fs.unlink(path.join(directory, file));
  const files = entries.filter((file) => /^[a-f0-9]{64}\.json$/.test(file));
  if (files.length > maxRecords) throw new ReportJobError("capacity", "持久任务数量超过目录预算");
  const records = new Map<string, { record: ReportJobRecord; bytes: number }>();
  let bytes = 0;
  for (const file of files) {
    const full = path.join(directory, file), stat = await fs.stat(full);
    bytes += stat.size;
    if (stat.size > 4_000_000 || bytes > maxBytes) throw new ReportJobError("capacity", "持久任务文件超过容量预算");
    const record = JSON.parse(await fs.readFile(full, "utf8")) as ReportJobRecord;
    validateJobRecord(record, record.scope, record.id, record.revision - 1);
    if (fileName(record.scope, record.id) !== file) throw new ReportJobError("input", "持久任务文件身份不匹配");
    records.set(file, { record, bytes: stat.size });
  }
  return { records, bytes };
}
async function writeAtomic(directory: string, file: string, text: string): Promise<void> {
  const temporary = path.join(directory, `.pending-${randomUUID()}`);
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, path.join(directory, file));
    const parent = await fs.open(directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await fs.unlink(temporary).catch((error: unknown) => { if (errorCode(error) !== "ENOENT") throw error; }); }
}

/** Durable local store with one process owner; database adapters provide multi-instance atomic CAS. */
export async function openFileReportJobStore(options: FileReportJobStoreOptions): Promise<FileReportJobStore> {
  const directory = path.resolve(options.directory), maxRecords = options.maxRecords ?? 10_000, maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (![maxRecords, maxBytes].every((value) => Number.isSafeInteger(value) && value > 0)) throw new ReportJobError("input", "持久任务预算应为正整数");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = await lockDirectory(directory, options.recoverDeadOwner ?? false);
  let state: Awaited<ReturnType<typeof loadRecords>>;
  try { state = await loadRecords(directory, maxRecords, maxBytes); }
  catch (error) { await lock.handle.close(); await fs.unlink(lock.file); throw error; }
  let closed = false, pending = Promise.resolve();
  const ensureOpen = () => { if (closed) throw new ReportJobError("closed", "持久任务存储已关闭"); };
  const persist: ReportJobStore["compareAndSwap"] = async (scope, id, revision, next) => {
    ensureOpen();
    const snapshot = JSON.parse(serializeJobJson(next)) as ReportJobRecord;
    validateJobRecord(snapshot, scope, id, revision);
    let written = false;
    const task = pending.then(async () => {
      if ((JSON.parse(await fs.readFile(lock.file, "utf8")) as { token: string }).token !== lock.token) throw new ReportJobError("closed", "持久任务存储写入锁已失效");
      const file = fileName(scope, id), previous = state.records.get(file);
      if ((previous?.record.revision ?? null) !== revision) return;
      validateJobTransition(previous?.record, snapshot);
      const text = serializeJobJson(snapshot), bytes = Buffer.byteLength(text, "utf8"), total = state.bytes - (previous?.bytes ?? 0) + bytes;
      if (total > maxBytes || !previous && state.records.size >= maxRecords) throw new ReportJobError("capacity", "持久任务容量已满，请归档旧任务或扩大显式预算");
      try { await writeAtomic(directory, file, text); }
      catch (error) {
        // rename may have committed before directory fsync failed: reads must reflect disk truth.
        if (await readOptional(path.join(directory, file)) === text) { state.records.set(file, { record: snapshot, bytes }); state.bytes = total; }
        throw error;
      }
      state.records.set(file, { record: snapshot, bytes }); state.bytes = total; written = true;
    });
    pending = task.catch(() => undefined); await task; return written;
  };
  return {
    read: async (scope, id) => { ensureOpen(); checkJobIdentity(scope, id); await pending; const value = state.records.get(fileName(scope, id)); return value ? cloneJob(value.record) : undefined; },
    candidates: async (now, limit) => { ensureOpen(); await pending; return Array.from(state.records.values(), (value) => value.record).filter((record) => runnableJob(record, now)).sort((a, b) => a.createdAt - b.createdAt).slice(0, limit).map(cloneJob); },
    compareAndSwap: persist,
    close: async () => {
      if (closed) return; closed = true; await pending; await lock.handle.close();
      const value = await readOptional(lock.file);
      if (value && (JSON.parse(value) as { token: string }).token === lock.token) await fs.unlink(lock.file);
    }
  };
}
