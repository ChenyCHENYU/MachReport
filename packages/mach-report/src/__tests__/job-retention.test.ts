// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryReportJobStore, serializeJobJson } from "../server/job-store";
import { createReportJobService } from "../server/job-service";
import { jobChargedBytes, jobRequestHash, jobStoreBudget } from "../server/job-retention";
import { portableSha256Hex, portableSha256HexAsync } from "../server/sha256";
import { openFileReportJobStore } from "../server/node-job-store";

const input = { scope: "tenant:a", id: "one", kind: "export", payload: { secret: "business-only" } };
const seed = { scope: input.scope, id: input.id, revision: 1, request: { kind: input.kind, payload: input.payload }, status: "queued" as const, createdAt: 1000, updatedAt: 1000, attempt: 0 };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));
describe("bounded durable task lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("matches standard SHA-256 vectors and padding boundaries without global WebCrypto", async () => {
    vi.stubGlobal("crypto", undefined);
    for (const text of ["", "abc", "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "a".repeat(1_000_000), "中文😀"]) {
      const bytes = new TextEncoder().encode(text);
      expect(portableSha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(await portableSha256HexAsync(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    for (const size of [1, 31, 55, 56, 63, 64, 65, 127, 128, 129, 1025]) {
      const bytes = Uint8Array.from({ length: size }, (_, index) => index * 73 + 19 & 255);
      expect(portableSha256Hex(bytes.subarray(0))).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
    const request = { kind: "export", payload: { unicode: "中文😀", zero: 0 } };
    expect(await jobRequestHash(request)).toBe(createHash("sha256").update(serializeJobJson(request)).digest("hex"));
  });
  it("uses portable SHA-256 fingerprints matching Node crypto without persisting business payloads", async () => {
    const request = { kind: "export", payload: { z: "中文", a: 1 } };
    expect(await jobRequestHash(request)).toBe(createHash("sha256").update(serializeJobJson(request)).digest("hex"));
  });
  it("rejects a 149-byte store at admission instead of accepting work it cannot control", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "report-small-"));
    try {
      const store = await openFileReportJobStore({ directory, maxBytes: 149 });
      const service = createReportJobService({ store, handlers: { export: () => null } });
      await expect(service.submit(input)).rejects.toMatchObject({ code: "capacity" });
      expect(await service.get(input.scope, input.id)).toBeUndefined();
      await service.close(); await store.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("reserves enough control bytes at exact capacity for running, progress, cancellation and failure", async () => {
    const budget = jobStoreBudget(), maxBytes = jobChargedBytes(seed, budget);
    const store = createMemoryReportJobStore({ maxBytes });
    let finish!: () => void;
    const service = createReportJobService({ store, now: () => 1000, heartbeatMs: 10, leaseMs: 100, handlers: {
      export: async (_payload, context) => { await context.reportProgress(1, 2); await new Promise<void>((resolve) => { finish = resolve; }); return "late"; }
    } });
    await service.submit(input);
    const task = service.runNext("w".repeat(128));
    while (!finish) await tick();
    expect((await service.cancel(input.scope, input.id)).cancelRequested).toBe(true);
    finish();
    expect(await task).toMatchObject({ status: "cancelled", progress: { completed: 1, total: 2 } });
    await service.close();
    const next = createReportJobService({ store: createMemoryReportJobStore({ maxBytes }), now: () => 1000, handlers: { export: () => { throw new Error("错".repeat(1000)); } } });
    await next.submit(input);
    expect(await next.runNext("w")).toMatchObject({ status: "failed", error: { code: "execution" } });
    await next.close();
  });
  it("turns a result that cannot fit the remaining store budget into a persisted terminal failure", async () => {
    const maxBytes = jobChargedBytes(seed, jobStoreBudget());
    const store = createMemoryReportJobStore({ maxBytes });
    const service = createReportJobService({ store, now: () => 1000, handlers: { export: () => ({ artifact: "reference" }) } });
    await service.submit(input);
    expect(await service.runNext("w")).toMatchObject({ status: "failed", error: { code: "result-budget" } });
    expect(await service.runNext("w")).toBeUndefined();
    await service.close();
  });
  it("keeps file-store controls available at exact reserved capacity after reopening", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "report-control-"));
    const maxBytes = jobChargedBytes(seed, jobStoreBudget());
    try {
      let store = await openFileReportJobStore({ directory, maxBytes });
      let service = createReportJobService({ store, now: () => 1000, handlers: { export: () => null } });
      await service.submit(input); await service.close(); await store.close();
      store = await openFileReportJobStore({ directory, maxBytes });
      service = createReportJobService({ store, now: () => 1000, handlers: { export: () => { throw new Error("explicit failure"); } } });
      expect(await service.runNext("worker")).toMatchObject({ status: "failed", error: { code: "execution" } });
      await service.retry(input.scope, input.id, (await service.get(input.scope, input.id))!.revision);
      expect(await service.cancel(input.scope, input.id)).toMatchObject({ status: "cancelled" });
      await service.close(); await store.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("never archives running work even when the retention cutoff includes its timestamp", async () => {
    let finish!: () => void;
    const service = createReportJobService({ store: createMemoryReportJobStore(), now: () => 1000, handlers: { export: () => new Promise<null>((resolve) => { finish = () => resolve(null); }) } });
    await service.submit(input); const task = service.runNext("worker");
    while (!finish) await tick();
    expect(await service.prune({ terminalBefore: 1000 })).toEqual({ archived: 0, expired: 0 });
    expect((await service.get(input.scope, input.id))?.status).toBe("running");
    finish(); expect((await task)?.status).toBe("completed"); await service.close();
  });
  it("enforces an independent result budget with older store adapters and preserves their compatibility", async () => {
    const base = createMemoryReportJobStore();
    const store = { read: base.read, candidates: base.candidates, compareAndSwap: base.compareAndSwap };
    const service = createReportJobService({ store, maxResultBytes: 3, handlers: { export: () => "large" } });
    await service.submit(input);
    expect(await service.runNext("w")).toMatchObject({ status: "failed", error: { code: "result-budget" } });
    await expect(service.prune({ terminalBefore: 0 })).rejects.toMatchObject({ code: "input" });
    await service.close();
  });
  it("archives terminal jobs only, retains idempotency through restart and releases it after explicit expiry", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "report-retain-"));
    let now = 1000;
    try {
      let store = await openFileReportJobStore({ directory, maxRecords: 2, maxTombstones: 2 });
      let service = createReportJobService({ store, now: () => now, handlers: { export: () => "artifact" } });
      await service.submit(input); await service.runNext("w");
      await service.submit({ ...input, id: "active" });
      now = 2000;
      expect(await service.prune({ terminalBefore: now, tombstoneRetentionMs: 100, limit: 1 })).toEqual({ archived: 1, expired: 0 });
      expect(await service.get(input.scope, input.id)).toBeUndefined();
      expect((await service.get(input.scope, "active"))?.status).toBe("queued");
      expect(await service.submit(input)).toMatchObject({ status: "completed", archived: true });
      await expect(service.submit({ ...input, payload: null })).rejects.toMatchObject({ code: "conflict" });
      const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
      const contents = await Promise.all(files.map((file) => readFile(path.join(directory, file), "utf8")));
      const tombstone = contents.find((text) => text.includes('"tombstone"'))!;
      expect(tombstone).not.toContain("business-only"); expect(tombstone).not.toContain("artifact");
      await service.close(); await store.close();
      store = await openFileReportJobStore({ directory, maxRecords: 2, maxTombstones: 2 });
      service = createReportJobService({ store, now: () => now, handlers: { export: () => "artifact" } });
      expect(await service.submit(input)).toMatchObject({ archived: true });
      now = 2100;
      expect(await service.prune({ terminalBefore: 0 })).toEqual({ archived: 0, expired: 1 });
      expect(await service.submit({ ...input, payload: null })).toMatchObject({ status: "queued", revision: 1 });
      await service.close(); await store.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("atomically maintains capacity during concurrent archive, replay and new submissions", async () => {
    let now = 1000;
    const store = createMemoryReportJobStore({ maxRecords: 1, maxTombstones: 1 });
    const service = createReportJobService({ store, now: () => now, handlers: { export: () => null } });
    await service.submit(input); await service.runNext("w"); now++;
    const [prune, replay] = await Promise.all([service.prune({ terminalBefore: now }), service.submit(input)]);
    expect(prune.archived).toBe(1); expect(replay.status).toBe("completed");
    await service.submit({ ...input, id: "two" }); await service.runNext("w");
    expect(await service.prune({ terminalBefore: now })).toEqual({ archived: 0, expired: 0 });
    expect((await service.get(input.scope, "two"))?.status).toBe("completed");
    await service.close();
  });
});
