import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PlanPage } from "../schema/render-plan";
import { createDocumentStoreDriver, documentBudget, documentBytes, documentIdentity, documentSnapshot, ReportDocumentError, type ReportDocumentBudget, type ReportDocumentManifest, type ReportDocumentStore } from "./document-store";

export interface FileReportDocumentStore extends ReportDocumentStore { close(): Promise<void> }
export interface FileReportDocumentStoreOptions extends ReportDocumentBudget { directory: string }
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
const keyFor = (scope: string, id: string) => createHash("sha256").update(documentIdentity(scope, id)).digest("hex");
async function readJson<T>(file: string, maxBytes: number): Promise<T> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > maxBytes) throw new ReportDocumentError("capacity", "文档文件类型或大小无效");
  return documentSnapshot(JSON.parse(await fs.readFile(file, "utf8")) as T, maxBytes);
}
async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.pending-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch((error: unknown) => { if (code(error) !== "ENOENT") throw error; }); }
}
async function loadManifests(directory: string, budget: Required<ReportDocumentBudget>): Promise<ReportDocumentManifest[]> {
  const folders = (await fs.readdir(directory)).filter(value => /^[a-f0-9]{64}$/.test(value));
  if (folders.length > budget.maxDocuments) throw new ReportDocumentError("capacity", "文档数量超过目录预算");
  const manifests: ReportDocumentManifest[] = [];
  for (const folder of folders) {
    const location = path.join(directory, folder), stat = await fs.lstat(location);
    if (!stat.isDirectory()) throw new ReportDocumentError("input", "文档目录不允许符号链接");
    const manifest = await readJson<ReportDocumentManifest>(path.join(location, "manifest.json"), budget.maxManifestBytes);
    if (keyFor(manifest.scope, manifest.id) !== folder || !Number.isSafeInteger(manifest.pageCount) || manifest.pageCount < 0 || manifest.pageCount > budget.maxPages) throw new ReportDocumentError("input", "文档清单身份或页数无效");
    let bytes = documentBytes(manifest);
    for (let index = 0; index < manifest.pageCount; index++) {
      const page = await fs.lstat(path.join(location, `${index}.json`));
      if (!page.isFile() || page.size > budget.maxPageBytes) throw new ReportDocumentError("capacity", "文档页文件类型或大小无效");
      bytes += page.size;
    }
    if (bytes !== manifest.bytes) throw new ReportDocumentError("input", "文档字节数与已提交页不一致");
    // Ignore/unlink only known uncommitted remnants while the exclusive writer lock is held.
    for (const name of await fs.readdir(location)) {
      const page = /^(\d+)\.json$/.exec(name);
      if (page && Number(page[1]) >= manifest.pageCount || /\.pending-[a-f0-9-]{36}$/.test(name)) await fs.unlink(path.join(location, name));
    }
    manifests.push(manifest);
  }
  return manifests;
}

/** Exclusive-process disk reference. Pages stay on disk; manifest/page reads and appends are bounded. */
export async function openFileReportDocumentStore(options: FileReportDocumentStoreOptions): Promise<FileReportDocumentStore> {
  const budget = documentBudget(options), directory = path.resolve(options.directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const lockFile = path.join(directory, ".document-writer-lock");
  const token = randomUUID();
  let lock;
  try { lock = await fs.open(lockFile, "wx", 0o600); }
  catch (error) { if (code(error) === "EEXIST") throw new ReportDocumentError("conflict", "文档目录已被占用；多实例请实现共享存储原子CAS"); throw error; }
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, token })); }
  catch (error) { await lock.close(); await fs.unlink(lockFile); throw error; }
  const ownsLock = async (): Promise<boolean> => {
    try { return (await readJson<{ token?: string }>(lockFile, 1024)).token === token; }
    catch (error) { if (code(error) === "ENOENT") return false; throw error; }
  };
  const guard = async () => { if (!await ownsLock()) throw new ReportDocumentError("closed", "文档存储写入锁已失效"); };
  let pending = Promise.resolve(), closed = false;
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new ReportDocumentError("closed", "文档存储已关闭"));
    // The shared core serializes I/O and captures caller inputs synchronously before its first await.
    const task = run(); pending = Promise.allSettled([pending, task]).then(() => undefined); return task;
  };
  let store: ReportDocumentStore;
  try {
    const loaded = await loadManifests(directory, budget);
    store = createDocumentStoreDriver({
      write: async (manifest, page) => {
        await guard();
        const folder = path.join(directory, keyFor(manifest.scope, manifest.id));
        await fs.mkdir(folder, { recursive: true, mode: 0o700 });
        if (page) await atomicJson(path.join(folder, `${page.index}.json`), page.value);
        try { await atomicJson(path.join(folder, "manifest.json"), manifest); }
        catch (error) {
          if (page) await fs.unlink(path.join(folder, `${page.index}.json`));
          else if (manifest.revision === 0) await fs.rm(folder, { recursive: true });
          throw error;
        }
      },
      readPage: async (scope, id, index) => { await guard(); return readJson<PlanPage>(path.join(directory, keyFor(scope, id), `${index}.json`), budget.maxPageBytes); },
      remove: async manifest => { await guard(); await fs.rm(path.join(directory, keyFor(manifest.scope, manifest.id)), { recursive: true }); }
    }, budget, loaded);
  } catch (error) { await lock.close(); await fs.unlink(lockFile); throw error; }
  return {
    create: (...args) => serialize(() => store.create(...args)), append: (...args) => serialize(() => store.append(...args)),
    complete: (...args) => serialize(() => store.complete(...args)),
    fail: (...args) => serialize(() => store.fail(...args)),
    read: (...args) => serialize(() => store.read(...args)),
    readPage: (...args) => serialize(() => store.readPage(...args)), remove: (...args) => serialize(() => store.remove(...args)),
    close: async () => { if (closed) return; closed = true; await pending; await lock.close(); if (await ownsLock()) await fs.unlink(lockFile); }
  };
}
