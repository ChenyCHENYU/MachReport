// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createMemoryReportJobStore,
  serializeJobJson,
} from "../server/job-store";
import {
  createReportJobService,
  type ReportJobExecutionContext,
} from "../server/job-service";
import { openFileReportJobStore } from "../server/node-job-store";

const request = {
  scope: "plant:YTS0",
  id: "export-1",
  kind: "xlsx",
  payload: { report: "daily", date: "2026-10-19" },
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));
describe("durable report jobs", () => {
  it("deduplicates canonical requests by scope and rejects conflicting reuse", async () => {
    const store = createMemoryReportJobStore();
    const service = createReportJobService({
      store,
      handlers: { xlsx: () => ({ artifact: "safe-reference" }) },
    });
    const [a, b] = await Promise.all([
      service.submit(request),
      service.submit({
        ...request,
        payload: { date: "2026-10-19", report: "daily" },
      }),
    ]);
    expect(a.revision).toBe(1);
    expect(b.revision).toBe(1);
    await expect(
      service.submit({ ...request, payload: { report: "other" } }),
    ).rejects.toMatchObject({ code: "conflict" });
    await service.submit({ ...request, scope: "other-tenant" });
    const completed = await service.runNext("node-a");
    expect(completed).toMatchObject({
      status: "completed",
      attempt: 1,
      result: { artifact: "safe-reference" },
    });
    expect(completed?.lease).toBeUndefined();
    expect((await service.get("other-tenant", request.id))?.status).toBe(
      "queued",
    );
    await service.close();
  });

  it("atomically claims a task across two instances and keeps slots until actual completion", async () => {
    const store = createMemoryReportJobStore();
    let finish!: (value: string) => void,
      calls = 0;
    const handler = () => {
      calls++;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    };
    const a = createReportJobService({ store, handlers: { xlsx: handler } }),
      b = createReportJobService({ store, handlers: { xlsx: handler } });
    await a.submit(request);
    const running = a.runNext("node-a");
    while (!finish) await tick();
    expect(await b.runNext("node-b")).toBeUndefined();
    expect(calls).toBe(1);
    await expect(a.runNext("node-a")).rejects.toMatchObject({
      code: "capacity",
    });
    finish("ready");
    expect((await running)?.status).toBe("completed");
    expect(a.active).toBe(0);
    await Promise.all([a.close(), b.close()]);
  });

  it("persists running cancellation and never records late successful handler data", async () => {
    const store = createMemoryReportJobStore();
    let finish!: (value: string) => void, signal: AbortSignal | undefined;
    const service = createReportJobService({
      store,
      leaseMs: 200,
      heartbeatMs: 10,
      handlers: {
        xlsx: (_payload, context) => {
          signal = context.signal;
          return new Promise<string>((resolve) => {
            finish = resolve;
          });
        },
      },
    });
    await service.submit(request);
    const running = service.runNext("node-a");
    while (!finish) await tick();
    await service.cancel(request.scope, request.id);
    while (!signal?.aborted) await tick();
    expect(service.active).toBe(1);
    finish("must-not-be-published");
    expect(await running).toMatchObject({ status: "cancelled" });
    expect(
      (await service.get(request.scope, request.id))?.result,
    ).toBeUndefined();
    await service.close();
  });

  it("recovers expired leases and fences a prior attempt even with the same worker name", async () => {
    let now = 1000,
      finish!: (value: string) => void;
    const store = createMemoryReportJobStore();
    const a = createReportJobService({
      store,
      now: () => now,
      leaseMs: 100,
      heartbeatMs: 40,
      handlers: {
        xlsx: () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      },
    });
    const b = createReportJobService({
      store,
      now: () => now,
      leaseMs: 100,
      heartbeatMs: 40,
      handlers: { xlsx: () => "new-attempt" },
    });
    await a.submit(request);
    const old = a.runNext("same-worker");
    while (!finish) await tick();
    now = 1101;
    expect(await b.runNext("same-worker")).toMatchObject({
      status: "completed",
      attempt: 2,
      result: "new-attempt",
    });
    const rejected = expect(old).rejects.toMatchObject({ code: "lease" });
    finish("late");
    await rejected;
    expect((await b.get(request.scope, request.id))?.result).toBe(
      "new-attempt",
    );
    await Promise.all([a.close(), b.close()]);
  });

  it("fails with a stored diagnostic and only explicitly retries the current failed revision", async () => {
    let failed = true;
    const store = createMemoryReportJobStore(),
      service = createReportJobService({
        store,
        handlers: {
          xlsx: () => {
            if (failed) throw new Error("dataset unavailable");
            return "ok";
          },
        },
      });
    await service.submit(request);
    const first = await service.runNext("a");
    expect(first).toMatchObject({
      status: "failed",
      error: { code: "execution", message: "dataset unavailable" },
    });
    await expect(
      service.retry(request.scope, request.id, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    failed = false;
    await service.retry(request.scope, request.id, first!.revision);
    const second = await service.runNext("a");
    expect(second).toMatchObject({
      status: "completed",
      attempt: 2,
      result: "ok",
    });
    expect(second?.error).toBeUndefined();
    await service.close();
    await expect(service.runNext("a")).rejects.toMatchObject({
      code: "closed",
    });
  });

  it("survives a file-store restart, preserves CAS, and refuses concurrent process owners", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mach-report-jobs-"));
    try {
      const first = await openFileReportJobStore({ directory });
      const service = createReportJobService({
        store: first,
        handlers: { xlsx: () => "saved-file" },
      });
      await service.submit(request);
      await expect(
        openFileReportJobStore({ directory, recoverDeadOwner: true }),
      ).rejects.toMatchObject({ code: "conflict" });
      await service.close();
      await first.close();
      const second = await openFileReportJobStore({ directory });
      const restored = createReportJobService({
        store: second,
        handlers: { xlsx: () => "saved-file" },
      });
      expect((await restored.get(request.scope, request.id))?.status).toBe(
        "queued",
      );
      expect(await restored.runNext("after-restart")).toMatchObject({
        status: "completed",
        result: "saved-file",
      });
      await restored.close();
      await second.close();
      const final = await openFileReportJobStore({ directory });
      expect((await final.read(request.scope, request.id))?.result).toBe(
        "saved-file",
      );
      await final.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed JSON and bounded-storage overflow without writing a partial task", async () => {
    const value = Object.defineProperty({}, "secret", {
      get() {
        throw new Error("must not execute");
      },
      enumerable: true,
    });
    expect(() => serializeJobJson(value)).toThrow(/访问器/);
    expect(() => serializeJobJson(new Array(5))).toThrow(/稀疏/);
    expect(() => serializeJobJson({ big: "a".repeat(1_000_001) })).toThrow(
      /预算/,
    );
    const directory = await mkdtemp(
      path.join(tmpdir(), "mach-report-job-budget-"),
    );
    try {
      const store = await openFileReportJobStore({ directory, maxRecords: 1 });
      const service = createReportJobService({
        store,
        handlers: { xlsx: () => null },
      });
      await service.submit(request);
      await expect(
        service.submit({ ...request, id: "second" }),
      ).rejects.toMatchObject({ code: "capacity" });
      expect(await store.read(request.scope, "second")).toBeUndefined();
      await service.close();
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an oversized combined result as a terminal failure instead of a poison retry loop", async () => {
    const store = createMemoryReportJobStore();
    const service = createReportJobService({
      store,
      handlers: { xlsx: () => "r".repeat(600_000) },
    });
    await service.submit({ ...request, payload: "p".repeat(600_000) });
    const failed = await service.runNext("a");
    expect(failed).toMatchObject({
      status: "failed",
      error: { code: "result-budget" },
    });
    expect(failed?.result).toBeUndefined();
    expect(failed?.lease).toBeUndefined();
    expect(await service.runNext("a")).toBeUndefined();
    await service.close();
  });

  it("records an internal heartbeat fault as a failure rather than user cancellation", async () => {
    const original = createMemoryReportJobStore();
    let reads = 0,
      finish!: (value: string) => void;
    const store = {
      ...original,
      read: async (scope: string, id: string) => {
        if (++reads === 2) throw new Error("storage heartbeat unavailable");
        return original.read(scope, id);
      },
    };
    const service = createReportJobService({
      store,
      leaseMs: 200,
      heartbeatMs: 10,
      handlers: {
        xlsx: (_payload, context) =>
          new Promise<string>((resolve) => {
            finish = resolve;
            context.signal.addEventListener("abort", () => finish("late"));
          }),
      },
    });
    await service.submit(request);
    expect(await service.runNext("a")).toMatchObject({
      status: "failed",
      error: { message: "storage heartbeat unavailable" },
    });
    await service.close();
  });

  it("detaches queued file writes and serializes dead-owner recovery across openers", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "mach-report-job-recovery-"),
    );
    try {
      const deadPid = Number(
        execFileSync(
          process.execPath,
          ["-e", "process.stdout.write(String(process.pid))"],
          { encoding: "utf8" },
        ),
      );
      await writeFile(
        path.join(directory, ".writer-lock"),
        JSON.stringify({ pid: deadPid, token: "dead" }),
      );
      const opened = await Promise.allSettled([
        openFileReportJobStore({ directory, recoverDeadOwner: true }),
        openFileReportJobStore({ directory, recoverDeadOwner: true }),
      ]);
      expect(
        opened.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const successful = opened.find((result) => result.status === "fulfilled");
      if (!successful || successful.status !== "fulfilled")
        throw new Error("fixture");
      const store = successful.value,
        now = Date.now();
      const record = {
        scope: request.scope,
        id: request.id,
        revision: 1,
        request: { kind: request.kind, payload: request.payload },
        status: "queued" as const,
        createdAt: now,
        updatedAt: now,
        attempt: 0,
      };
      const pending = store.compareAndSwap(
        record.scope,
        record.id,
        null,
        record,
      );
      record.scope = "changed-after-call";
      record.revision = 999;
      expect(await pending).toBe(true);
      expect(await store.read(request.scope, request.id)).toMatchObject({
        scope: request.scope,
        revision: 1,
      });
      await store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("finalizes a persisted cancellation after lease expiry without invoking the replacement handler", async () => {
    let now = 1000,
      finish!: (value: string) => void,
      sideEffects = 0;
    const store = createMemoryReportJobStore();
    const first = createReportJobService({
      store,
      now: () => now,
      leaseMs: 100,
      heartbeatMs: 40,
      handlers: {
        xlsx: () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      },
    });
    const restored = createReportJobService({
      store,
      now: () => now,
      leaseMs: 100,
      heartbeatMs: 40,
      handlers: {
        xlsx: () => {
          sideEffects++;
          return "must-not-publish";
        },
      },
    });
    await first.submit(request);
    const previous = first.runNext("previous-process");
    while (!finish) await tick();
    await first.cancel(request.scope, request.id);
    now = 1101;
    expect(await restored.runNext("restored-process")).toMatchObject({
      status: "cancelled",
      attempt: 1,
      cancelRequested: true,
    });
    expect(sideEffects).toBe(0);
    expect(
      (await store.read(request.scope, request.id))?.lease,
    ).toBeUndefined();
    const fenced = expect(previous).rejects.toMatchObject({ code: "lease" });
    finish("late");
    await fenced;
    await Promise.all([first.close(), restored.close()]);
  });

  it("coalesces high-frequency heartbeats behind slow storage and acknowledges the latest progress before completion", async () => {
    vi.useFakeTimers();
    const original = createMemoryReportJobStore();
    let reads = 0,
      runningWrites = 0,
      release!: () => void,
      finish!: (value: string) => void;
    let context: ReportJobExecutionContext | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = {
      ...original,
      read: async (scope: string, id: string) => {
        if (++reads === 2) await gate;
        return original.read(scope, id);
      },
      compareAndSwap: async (
        ...args: Parameters<typeof original.compareAndSwap>
      ) => {
        if (args[3].status === "running") runningWrites++;
        return original.compareAndSwap(...args);
      },
    };
    const service = createReportJobService({
      store,
      now: () => 1000,
      leaseMs: 1000,
      heartbeatMs: 10,
      handlers: {
        xlsx: (_payload, value) => {
          context = value;
          return new Promise<string>((resolve) => {
            finish = resolve;
          });
        },
      },
    });
    let running: ReturnType<typeof service.runNext> | undefined;
    try {
      await service.submit(request);
      running = service.runNext("slow-store");
      await vi.advanceTimersByTimeAsync(10);
      expect(context).toBeDefined();
      const first = context!.reportProgress(1, 100),
        middle = context!.reportProgress(50, 100),
        latest = context!.reportProgress(100, 100);
      await vi.advanceTimersByTimeAsync(1000);
      finish("ready");
      await vi.advanceTimersByTimeAsync(0);
      expect(service.active).toBe(1);
      release();
      await Promise.all([first, middle, latest]);
      expect(await running).toMatchObject({
        status: "completed",
        progress: { completed: 100, total: 100 },
      });
      // One claim, one blocked heartbeat and one latest progress update, independent of 100 timer ticks.
      expect(runningWrites).toBeLessThanOrEqual(3);
      expect(reads).toBeLessThanOrEqual(5);
    } finally {
      release();
      finish?.("cleanup");
      if (running) await running.catch(() => undefined);
      await service.close();
      vi.useRealTimers();
    }
  });

  it("does not drain obsolete timer ticks after a cancellation wins during a slow heartbeat", async () => {
    vi.useFakeTimers();
    const original = createMemoryReportJobStore();
    let reads = 0,
      release!: () => void;
    let context: ReportJobExecutionContext | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = {
      ...original,
      read: async (scope: string, id: string) => {
        if (++reads === 2) await gate;
        return original.read(scope, id);
      },
    };
    const service = createReportJobService({
      store,
      now: () => 1000,
      leaseMs: 1000,
      heartbeatMs: 10,
      handlers: {
        xlsx: (_payload, value) => {
          context = value;
          return new Promise<string>((resolve) => {
            value.signal.addEventListener("abort", () => resolve("late"), {
              once: true,
            });
          });
        },
      },
    });
    let running: ReturnType<typeof service.runNext> | undefined;
    try {
      await service.submit(request);
      running = service.runNext("cancel-slow-store");
      await vi.advanceTimersByTimeAsync(10);
      const latest = context!.reportProgress(20, 100);
      await vi.advanceTimersByTimeAsync(1000);
      await service.cancel(request.scope, request.id);
      release();
      await latest;
      expect(await running).toMatchObject({ status: "cancelled" });
      expect(context!.signal.aborted).toBe(true);
      expect(reads).toBeLessThanOrEqual(6);
      expect(
        (await original.read(request.scope, request.id))?.result,
      ).toBeUndefined();
    } finally {
      release();
      await service.close();
      if (running) await running.catch(() => undefined);
      vi.useRealTimers();
    }
  });

  it("does not start a handler when shutdown occurs while a store claim is pending", async () => {
    const original = createMemoryReportJobStore();
    let release!: () => void,
      sideEffects = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = {
      ...original,
      candidates: async (now: number, limit: number) => {
        await gate;
        return original.candidates(now, limit);
      },
    };
    const service = createReportJobService({
      store,
      handlers: {
        xlsx: () => {
          sideEffects++;
          return "must-not-publish";
        },
      },
    });
    await service.submit(request);
    const running = service.runNext("closing-process");
    const closed = service.close();
    release();
    expect(await running).toMatchObject({ status: "cancelled" });
    await closed;
    expect(sideEffects).toBe(0);
    expect(service.active).toBe(0);
  });
  it("detaches a validated handler result before asynchronous finalization", async () => {
    const original = createMemoryReportJobStore();
    let reads = 0,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = {
      ...original,
      read: async (scope: string, id: string) => {
        if (++reads === 2) await gate;
        return original.read(scope, id);
      },
    };
    const result = { artifact: "original-reference", metadata: { rows: 10 } };
    const service = createReportJobService({
      store,
      handlers: { xlsx: () => result },
    });
    await service.submit(request);
    const running = service.runNext("stable-result");
    while (reads < 2) await tick();
    result.artifact = "later-mutation";
    result.metadata.rows = 999;
    release();
    expect(await running).toMatchObject({
      status: "completed",
      result: { artifact: "original-reference", metadata: { rows: 10 } },
    });
    await service.close();
  });

  it("rejects a timer interval that Node would silently clamp to one millisecond", () => {
    expect(() =>
      createReportJobService({
        store: createMemoryReportJobStore(),
        heartbeatMs: 2_147_483_648,
        leaseMs: 4_294_967_296,
        handlers: { xlsx: () => null },
      }),
    ).toThrow(/定时器上限/);
  });
});
