// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryReportDocumentStore, readReportDocumentPages, writeReportDocument, type ReportDocumentStore } from "../server";
import { openFileReportDocumentStore } from "../server/node-document-store";
import { RENDER_PLAN_SCHEMA_VERSION, type PlanPage } from "../schema/render-plan";

const page = (value = "hello"): PlanPage => ({ pageWidthMm: 210, pageHeightMm: 297, components: [{ kind: "text", leftMm: 5, topMm: 5, widthMm: 20, heightMm: 10, text: value }] });
const identity = { scope: "tenant-a", id: "report", version: "query-1", plan: { schemaVersion: RENDER_PLAN_SCHEMA_VERSION } };
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function temporary(): Promise<string> { const folder = await mkdtemp(path.join(tmpdir(), "mach-document-")); folders.push(folder); return folder; }
async function checkStore(store: ReportDocumentStore): Promise<void> {
  const manifest = await store.create(identity);
  const input = page("original"), writing = store.append(identity.scope, identity.id, identity.version, manifest.revision, input);
  input.components[0]!.text = "mutated";
  const next = await writing;
  expect(next).toMatchObject({ pageCount: 1, state: "building", revision: 1 });
  expect((await store.readPage(identity.scope, identity.id, identity.version, 0))?.components[0]?.text).toBe("original");
  await expect(store.append(identity.scope, identity.id, identity.version, 0, page())).rejects.toMatchObject({ code: "conflict" });
  await expect(store.readPage(identity.scope, identity.id, "different", 0)).rejects.toMatchObject({ code: "conflict" });
  expect(await store.read("tenant-b", identity.id)).toBeUndefined();
  await expect(store.readPage("tenant-b", identity.id, identity.version, 0)).rejects.toMatchObject({ code: "missing" });
  const window = await readReportDocumentPages(store, { ...identity, limit: 1 });
  expect(window.nextPage).toBe(1); expect(window.pages).toHaveLength(1); expect(window.manifest.state).toBe("building");
  const second = await store.append(identity.scope, identity.id, identity.version, 1, page("second"));
  await store.complete(identity.scope, identity.id, identity.version, second.revision);
  const tail = await readReportDocumentPages(store, { ...identity, fromPage: window.nextPage });
  expect(tail.pages[0]?.components[0]?.text).toBe("second"); expect(tail.manifest.state).toBe("complete");
  await expect(store.append(identity.scope, identity.id, identity.version, 3, page())).rejects.toMatchObject({ code: "conflict" });
  tail.pages[0]!.components[0]!.text = "output mutation";
  expect((await store.readPage(identity.scope, identity.id, identity.version, 1))?.components[0]?.text).toBe("second");
}
describe("bounded progressive report documents", () => {
  it("isolates scope/version, append CAS and input/output snapshots in memory", async () => { await checkStore(createMemoryReportDocumentStore()); });
  it("retains pages on disk across reopen and locks against a second writer", async () => {
    const directory = await temporary(), store = await openFileReportDocumentStore({ directory });
    try {
      await checkStore(store);
      await expect(openFileReportDocumentStore({ directory })).rejects.toMatchObject({ code: "conflict" });
    } finally { await store.close(); }
    await expect(store.read(identity.scope, identity.id)).rejects.toMatchObject({ code: "closed" });
    const reopened = await openFileReportDocumentStore({ directory });
    try {
      expect((await reopened.read(identity.scope, identity.id))?.pageCount).toBe(2);
      expect((await reopened.readPage(identity.scope, identity.id, identity.version, 1))?.components[0]?.text).toBe("second");
      await expect(reopened.remove(identity.scope, identity.id, "wrong-version")).rejects.toMatchObject({ code: "conflict" });
      expect(await reopened.remove(identity.scope, identity.id, identity.version)).toBe(true);
      expect(await reopened.remove(identity.scope, identity.id, identity.version)).toBe(false);
    } finally { await reopened.close(); }
  });
  it("bounds counts, page bytes, total bytes and read windows without partial commits", async () => {
    expect(() => createMemoryReportDocumentStore({ maxPages: 0 })).toThrow(/预算/);
    const store = createMemoryReportDocumentStore({ maxDocuments: 1, maxPages: 1 });
    await store.create(identity);
    await expect(store.create({ ...identity, id: "other" })).rejects.toMatchObject({ code: "capacity" });
    await expect(store.create(identity)).rejects.toMatchObject({ code: "conflict" });
    await store.append(identity.scope, identity.id, identity.version, 0, page());
    await expect(store.append(identity.scope, identity.id, identity.version, 1, page())).rejects.toMatchObject({ code: "capacity" });
    expect((await store.read(identity.scope, identity.id))?.pageCount).toBe(1);
    await expect(readReportDocumentPages(store, { ...identity, maxBytes: 1 })).rejects.toMatchObject({ code: "capacity" });
    await expect(readReportDocumentPages(store, { ...identity, limit: 33 })).rejects.toMatchObject({ code: "input" });
    const small = createMemoryReportDocumentStore({ maxBytes: 350 }); await small.create(identity);
    await expect(small.append(identity.scope, identity.id, identity.version, 0, page("x".repeat(300)))).rejects.toMatchObject({ code: "capacity" });
    expect((await small.read(identity.scope, identity.id))?.pageCount).toBe(0);
    expect(() => createMemoryReportDocumentStore({ maxPageBytes: 10 }).append(identity.scope, identity.id, identity.version, 0, page())).toThrow(/预算/);
  });
  it("consumes page iterators progressively and cancels without completing partial documents", async () => {
    const store = createMemoryReportDocumentStore(), controller = new AbortController();
    async function* generate() { yield page("first"); controller.abort(); yield page("cancelled"); }
    await expect(writeReportDocument(store, { ...identity, pages: generate(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(await store.read(identity.scope, identity.id)).toMatchObject({ state: "failed", pageCount: 1, failure: { code: "cancelled" } });
    await store.remove(identity.scope, identity.id, identity.version);
    const done = await writeReportDocument(store, { ...identity, pages: [page(), page()] });
    expect(done).toMatchObject({ state: "complete", pageCount: 2 });
  });
  it("validates final metadata and rejects malformed pages and unsafe identities", async () => {
    const store = createMemoryReportDocumentStore(); await store.create(identity);
    expect(() => store.append(identity.scope, identity.id, identity.version, 0, { ...page(), pageWidthMm: -1 })).toThrow();
    expect(() => store.create({ ...identity, scope: "" })).toThrow(/scope/);
    await expect(store.readPage(identity.scope, identity.id, identity.version, -1)).rejects.toMatchObject({ code: "input" });
    const metadata = { stats: { rows: 1, pages: 1, cells: 0, durationMs: 1 }, diagnostics: [], revisions: {} };
    await expect(store.complete(identity.scope, identity.id, identity.version, 0, metadata)).rejects.toMatchObject({ code: "input" });
    await store.append(identity.scope, identity.id, identity.version, 0, page());
    expect((await store.complete(identity.scope, identity.id, identity.version, 1, metadata)).metadata).toEqual(metadata);
    await expect(store.complete(identity.scope, identity.id, identity.version, 2)).rejects.toMatchObject({ code: "conflict" });
  });
  it("detects truncated or tampered disk manifests instead of accepting understated capacity", async () => {
    const directory = await temporary(), store = await openFileReportDocumentStore({ directory });
    await writeReportDocument(store, { ...identity, pages: [page()] }); await store.close();
    const key = createHash("sha256").update(JSON.stringify([identity.scope, identity.id])).digest("hex"), file = path.join(directory, key, "manifest.json");
    const manifest = JSON.parse(await readFile(file, "utf8")); manifest.bytes = 1; await writeFile(file, JSON.stringify(manifest));
    await expect(openFileReportDocumentStore({ directory })).rejects.toMatchObject({ code: "input" });
    await writeFile(file, "{"); await expect(openFileReportDocumentStore({ directory })).rejects.toThrow();
  });
  it("cancels a waiting producer promptly and fences its late page and stale failure", async () => {
    const store = createMemoryReportDocumentStore(), controller = new AbortController();
    let finish: ((value: IteratorResult<PlanPage>) => void) | undefined;
    const returned = { value: false };
    const pages: AsyncIterable<PlanPage> = { [Symbol.asyncIterator]: () => ({
      next: () => new Promise(resolve => { finish = resolve; }),
      return: async () => { returned.value = true; return { value: undefined, done: true }; }
    }) };
    const result = writeReportDocument(store, { ...identity, pages, signal: controller.signal });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(returned.value).toBe(true);
    finish?.({ value: page("late"), done: false }); await Promise.resolve();
    expect(await store.read(identity.scope, identity.id)).toMatchObject({ state: "failed", pageCount: 0 });
    await expect(store.fail(identity.scope, identity.id, identity.version, 1, { code: "generation", message: "stale" })).rejects.toMatchObject({ code: "conflict" });
    await store.remove(identity.scope, identity.id, identity.version);
    await store.create({ ...identity, version: "query-2" });
    await expect(store.fail(identity.scope, identity.id, identity.version, 0, { code: "generation", message: "stale" })).rejects.toMatchObject({ code: "conflict" });
    expect(await store.read(identity.scope, identity.id)).toMatchObject({ state: "building", version: "query-2" });
  });
  it("records producer failure, bounds windows by bytes and retains authoritative lock ownership", async () => {
    const store = createMemoryReportDocumentStore();
    async function* broken() { yield page(); throw new Error("sensitive SQL details"); }
    await expect(writeReportDocument(store, { ...identity, pages: broken() })).rejects.toThrow(/sensitive/);
    expect(await store.read(identity.scope, identity.id)).toMatchObject({ state: "failed", failure: { code: "generation", message: "报表文档生成失败" } });
    await store.create({ ...identity, id: "window" });
    await store.append(identity.scope, "window", identity.version, 0, page());
    await store.append(identity.scope, "window", identity.version, 1, page());
    const window = await readReportDocumentPages(store, { ...identity, id: "window", maxBytes: new TextEncoder().encode(JSON.stringify(page())).byteLength });
    expect(window.pages).toHaveLength(1); expect(window.nextPage).toBe(1);
    const directory = await temporary(), fileStore = await openFileReportDocumentStore({ directory });
    await fileStore.create(identity);
    const lockFile = path.join(directory, ".document-writer-lock");
    await writeFile(lockFile, JSON.stringify({ pid: process.pid, token: "another-owner" }));
    await expect(fileStore.append(identity.scope, identity.id, identity.version, 0, page())).rejects.toMatchObject({ code: "closed" });
    await fileStore.close(); expect(await readFile(lockFile, "utf8")).toContain("another-owner");
  });
});
