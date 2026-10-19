import { ReportJobError, type ReportJobRecord } from "./job-store";

type Progress = NonNullable<ReportJobRecord["progress"]>;
interface ProgressBatch {
  progress: Progress;
  promise: Promise<void>;
  resolve(): void;
  reject(cause: unknown): void;
}
function progressBatch(progress: Progress): ProgressBatch {
  let resolve!: () => void, reject!: (cause: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  // A handler may publish progress without awaiting it. Failure still aborts the execution.
  void promise.catch(() => undefined);
  return { progress, promise, resolve, reject };
}

function rejectedProgress(cause: unknown): Promise<void> {
  const rejected = Promise.reject<void>(cause);
  void rejected.catch(() => undefined);
  return rejected;
}

/** One actual write and one replaceable latest progress batch; timer ticks never accumulate. */
export function createReportJobHeartbeat(
  update: (progress?: Progress) => Promise<void>,
  onFailure: (cause: unknown) => void,
) {
  let active: Promise<void> | undefined, pending: ProgressBatch | undefined;
  let accepting = true,
    failure: unknown;
  function failed(cause: unknown): void {
    failure ??= cause ?? new Error("任务心跳更新失败");
    pending?.reject(failure);
    pending = undefined;
    onFailure(failure);
  }
  function start(batch?: ProgressBatch): void {
    const task = Promise.resolve()
      .then(() => update(batch?.progress))
      .then(
        () => batch?.resolve(),
        (cause: unknown) => {
          batch?.reject(cause);
          failed(cause);
        },
      )
      .finally(() => {
        active = undefined;
        const next = pending;
        pending = undefined;
        if (next && failure === undefined) start(next);
      });
    active = task;
    void task.catch((cause: unknown) => {
      failed(cause);
    });
  }
  function progress(value: Progress): Promise<void> {
    if (!accepting)
      return rejectedProgress(
        new ReportJobError("closed", "任务进度上报已结束"),
      );
    if (failure !== undefined) return rejectedProgress(failure);
    if (pending) pending.progress = value;
    else pending = progressBatch(value);
    const batch = pending;
    if (!active) {
      pending = undefined;
      start(batch);
    }
    return batch.promise;
  }
  return {
    progress,
    pulse(): void {
      if (accepting && !active && failure === undefined) start();
    },
    async finish(): Promise<void> {
      accepting = false;
      while (active) await active;
      if (failure !== undefined) throw failure;
    },
  };
}
