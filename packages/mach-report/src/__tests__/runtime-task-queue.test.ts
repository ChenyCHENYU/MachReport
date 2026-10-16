// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createReportTaskQueue } from "../server/task-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("有界可取消报表任务队列", () => {
  it("限制并发和排队长度，运行进度可读取且取消后不提前释放仍运行的槽位", async () => {
    const queue = createReportTaskQueue({ concurrency: 1, maxQueued: 1 });
    const running = deferred<number>();
    const a = queue.enqueue(({ reportProgress }) => { reportProgress(1, 3); return running.promise; });
    const b = queue.enqueue(() => 2);
    const rejected = a.result.catch((error: unknown) => error);
    await turn();
    expect(a.progress).toEqual({ completed: 1, total: 3 });
    expect(() => queue.enqueue(() => 3)).toThrow(expect.objectContaining({ code: "queue-full" }));
    a.cancel();
    expect(await rejected).toMatchObject({ name: "AbortError" });
    expect(a.status).toBe("cancelled");
    expect(queue.active).toBe(1); expect(queue.pending).toBe(1);
    running.resolve(1);
    expect(await b.result).toBe(2);
    await turn(); expect(queue.active).toBe(0);
  });
  it("排队取消不执行任务，并发请求ID拒绝，完成后允许相同ID再次入队", async () => {
    const queue = createReportTaskQueue({ concurrency: 1, maxQueued: 2 });
    const pending = deferred<number>();
    const a = queue.enqueue(() => pending.promise, { id: "a" });
    const controller = new AbortController();
    let executed = false;
    const b = queue.enqueue(() => { executed = true; }, { id: "b", signal: controller.signal });
    const result = b.result.catch((error: unknown) => error);
    expect(() => queue.enqueue(() => 3, { id: "a" })).toThrow();
    controller.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(queue.pending).toBe(0); expect(executed).toBe(false);
    pending.resolve(1); await a.result; await turn();
    expect(await queue.enqueue(() => 3, { id: "a" }).result).toBe(3);
  });
  it("关闭取消排队任务并拒绝新任务，默认允许运行任务完成", async () => {
    const queue = createReportTaskQueue(); const pending = deferred<number>();
    const a = queue.enqueue(() => pending.promise);
    const b = queue.enqueue(() => 2); const result = b.result.catch((error: unknown) => error);
    queue.close();
    expect(await result).toMatchObject({ name: "ReportRuntimeError", code: "closed" });
    expect(() => queue.enqueue(() => 3)).toThrow(expect.objectContaining({ code: "closed" }));
    pending.resolve(1); expect(await a.result).toBe(1);
  });
});
