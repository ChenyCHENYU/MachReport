import { jobByteLength, jobRequestHash, type ReportJobPruneOptions, type ReportJobPruneResult } from "./job-retention";
import { createReportJobHeartbeat } from "./job-heartbeat";
import {
  cloneJob,
  checkJobIdentity,
  ReportJobError,
  serializeJobJson,
  type ReportJobJson,
  type ReportJobRecord,
  type ReportJobRequest,
  type ReportJobStore,
} from "./job-store";

class ReportJobResultBudgetError extends ReportJobError {
  constructor() { super("capacity", "任务结果超过独立预算，请保存文件引用"); }
}

export interface ReportJobExecutionContext {
  scope: string;
  taskId: string;
  signal: AbortSignal;
  reportProgress(completed: number, total?: number): Promise<void>;
}
export type ReportJobHandler = (
  payload: ReportJobJson,
  context: ReportJobExecutionContext,
) => ReportJobJson | Promise<ReportJobJson>;
export interface ReportJobServiceOptions {
  store: ReportJobStore;
  handlers: Readonly<Record<string, ReportJobHandler>>;
  concurrency?: number;
  leaseMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  /** Result references have a separate byte budget; default 256KiB. */
  maxResultBytes?: number;
}
export interface ReportJobService {
  submit(
    input: ReportJobRequest & { scope: string; id: string },
  ): Promise<ReportJobRecord>;
  get(scope: string, id: string): Promise<ReportJobRecord | undefined>;
  cancel(scope: string, id: string): Promise<ReportJobRecord>;
  retry(
    scope: string,
    id: string,
    expectedRevision: number,
  ): Promise<ReportJobRecord>;
  /** Dispatch one queued/expired job. A scheduler controls when to call this method. */
  runNext(workerId: string): Promise<ReportJobRecord | undefined>;
  /** Stops new dispatch, signals active handlers and waits until their actual completion. */
  close(): Promise<void>;
  /** Archive terminal payloads and retain bounded idempotency fingerprints; never removes active work. */
  prune(options: Omit<ReportJobPruneOptions, "now">): Promise<ReportJobPruneResult>;
  readonly active: number;
}
function jobOptions(options: ReportJobServiceOptions) {
  const concurrency = options.concurrency ?? 1,
    leaseMs = options.leaseMs ?? 30_000,
    heartbeatMs = options.heartbeatMs ?? 10_000,
    maxResultBytes = options.maxResultBytes ?? 256 * 1024;
  if (
    ![concurrency, leaseMs, heartbeatMs, maxResultBytes].every(
      (item) => Number.isSafeInteger(item) && item > 0,
    ) ||
    heartbeatMs * 2 > leaseMs
  )
    throw new ReportJobError(
      "input",
      "并发、租约、心跳应为正整数，租约至少为心跳的两倍",
    );
  if (heartbeatMs > 2_147_483_647)
    throw new ReportJobError(
      "input",
      "心跳间隔超过平台定时器上限（2147483647毫秒）",
    );
  const now = () => {
    const value = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(value) || value < 0)
      throw new ReportJobError("input", "任务时钟应返回非负整数毫秒");
    return value;
  };
  return { concurrency, leaseMs, heartbeatMs, maxResultBytes, now };
}
async function required(
  store: ReportJobStore,
  scope: string,
  id: string,
): Promise<ReportJobRecord> {
  checkJobIdentity(scope, id);
  const record = await store.read(scope, id);
  if (!record) throw new ReportJobError("missing", "报表任务不存在");
  return record;
}
async function mutate(
  store: ReportJobStore,
  record: ReportJobRecord,
  update: Partial<ReportJobRecord>,
  remove: Array<keyof ReportJobRecord> = [],
): Promise<ReportJobRecord> {
  const next = { ...record, ...update, revision: record.revision + 1 };
  for (const key of remove) delete next[key];
  if (
    !(await store.compareAndSwap(
      record.scope,
      record.id,
      record.revision,
      next,
    ))
  )
    throw new ReportJobError("conflict", "报表任务已被其他请求更新");
  return cloneJob(next);
}
async function claim(
  options: ReportJobServiceOptions,
  workerId: string,
  leaseMs: number,
  now: number,
): Promise<ReportJobRecord | undefined> {
  if (!workerId.trim() || workerId.length > 128)
    throw new ReportJobError("input", "workerId应为1–128位标识");
  for (const candidate of await options.store.candidates(now, 100)) {
    const next: ReportJobRecord = candidate.cancelRequested
      ? {
          ...candidate,
          revision: candidate.revision + 1,
          status: "cancelled",
          updatedAt: now,
        }
      : {
          ...candidate,
          revision: candidate.revision + 1,
          status: "running",
          attempt: candidate.attempt + 1,
          updatedAt: now,
          lease: { owner: workerId, expiresAt: now + leaseMs },
        };
    if (next.status === "cancelled") delete next.lease;
    if (
      await options.store.compareAndSwap(
        candidate.scope,
        candidate.id,
        candidate.revision,
        next,
      )
    )
      return next;
  }
}
function owned(
  record: ReportJobRecord,
  owner: string,
  now: number,
  attempt: number,
): boolean {
  return (
    record.status === "running" &&
    record.attempt === attempt &&
    record.lease?.owner === owner &&
    record.lease.expiresAt > now
  );
}

async function executeJob(
  options: ReportJobServiceOptions,
  settings: ReturnType<typeof jobOptions>,
  claimed: ReportJobRecord,
  controller: AbortController,
): Promise<ReportJobRecord> {
  const { scope, id } = claimed,
    owner = claimed.lease!.owner;
  let heartbeatFailure: unknown;
  const heartbeat = createReportJobHeartbeat(
    async (progress) => {
      const record = await required(options.store, scope, id),
        now = settings.now();
      if (!owned(record, owner, now, claimed.attempt))
        throw new ReportJobError("lease", "报表任务租约已失效");
      if (record.cancelRequested) {
        controller.abort(new ReportJobError("closed", "任务已请求取消"));
        return;
      }
      await mutate(options.store, record, {
        updatedAt: now,
        lease: { owner, expiresAt: now + settings.leaseMs },
        ...(progress ? { progress } : {}),
      });
    },
    (cause) => {
      heartbeatFailure = cause;
      controller.abort(cause);
    },
  );
  const reportProgress = (completed: number, total?: number): Promise<void> => {
    if (
      !Number.isFinite(completed) ||
      completed < 0 ||
      (total !== undefined && (!Number.isFinite(total) || total < completed))
    )
      return Promise.reject(new ReportJobError("input", "任务进度无效"));
    return heartbeat.progress({
      completed,
      ...(total === undefined ? {} : { total }),
    });
  };
  const timer = setInterval(() => {
    heartbeat.pulse();
  }, settings.heartbeatMs);
  let result: ReportJobJson | undefined, failure: unknown;
  try {
    const handler = Object.prototype.hasOwnProperty.call(
      options.handlers,
      claimed.request.kind,
    )
      ? options.handlers[claimed.request.kind]
      : undefined;
    if (!handler) throw new ReportJobError("input", "报表任务处理器未注册");
    if (!controller.signal.aborted) {
      const value = await handler(cloneJob(claimed.request.payload), {
        scope,
        taskId: id,
        signal: controller.signal,
        reportProgress,
      });
      result = JSON.parse(serializeJobJson(value)) as ReportJobJson;
      if (jobByteLength(result) > settings.maxResultBytes) throw new ReportJobResultBudgetError();
    }
  } catch (error) {
    failure = error ?? new Error("报表任务执行失败");
  } finally {
    clearInterval(timer);
    await heartbeat.finish().catch(() => undefined);
  }
  const record = await required(options.store, scope, id),
    now = settings.now();
  if (!owned(record, owner, now, claimed.attempt))
    throw new ReportJobError("lease", "任务租约已失效，迟到结果不会写回");
  const next = { ...record, updatedAt: now };
  delete next.lease;
  failure ??= heartbeatFailure;
  if (
    record.cancelRequested ||
    (controller.signal.aborted && heartbeatFailure === undefined)
  )
    next.status = "cancelled";
  else if (failure !== undefined) {
    next.status = "failed";
    next.error = {
      code: failure instanceof ReportJobResultBudgetError ? "result-budget" : failure instanceof ReportJobError ? failure.code : "execution",
      message:
        failure instanceof Error
          ? failure.message.slice(0, 500)
          : "报表任务执行失败",
    };
  } else {
    next.status = "completed";
    next.result = result!;
  }
  try {
    serializeJobJson(next);
  } catch {
    delete next.result;
    next.status = "failed";
    next.error = {
      code: "result-budget",
      message: "任务结果与请求的组合超过存储预算，请保存文件引用而非文件内容",
    };
  }
  return persistJobOutcome(options.store, record, next);
}

async function persistJobOutcome(store: ReportJobStore, record: ReportJobRecord, next: ReportJobRecord): Promise<ReportJobRecord> {
  try { return await mutate(store, record, next, ["lease"]); }
  catch (error) {
    if (!(error instanceof ReportJobError) || error.code !== "capacity" || next.status !== "completed") throw error;
    // The store reserves the small failed state at admission; oversized artifacts never strand accepted work.
    delete next.result;
    next.status = "failed";
    next.error = { code: "result-budget", message: "任务结果超过存储剩余预算，请保存文件引用而非文件内容" };
    return mutate(store, record, next, ["lease", "result"]);
  }
}

async function archivedSubmission(store: ReportJobStore, scope: string, id: string, request: ReportJobRequest): Promise<ReportJobRecord | undefined> {
  const value = await store.readTombstone?.(scope, id);
  if (!value) return;
  if (value.requestHash !== await jobRequestHash(request)) throw new ReportJobError("conflict", "相同任务ID不能提交不同内容（幂等保留期内）");
  return { scope, id, revision: value.revision, request: cloneJob(request), status: value.status, createdAt: value.createdAt, updatedAt: value.updatedAt, attempt: value.attempt, archived: true };
}

/** Durable at-least-once dispatch; export/artifact handlers must be idempotent by scope+taskId. */
export function createReportJobService(
  options: ReportJobServiceOptions,
): ReportJobService {
  options = { ...options, handlers: { ...options.handlers } };
  const settings = jobOptions(options),
    controllers = new Set<AbortController>(),
    running = new Set<Promise<ReportJobRecord | undefined>>();
  let closed = false,
    active = 0;
  const get = (scope: string, id: string) => {
    checkJobIdentity(scope, id);
    return options.store.read(scope, id);
  };
  const submit: ReportJobService["submit"] = async (input) => {
    input = { ...input };
    checkJobIdentity(input.scope, input.id);
    if (
      !Object.prototype.hasOwnProperty.call(options.handlers, input.kind) ||
      typeof options.handlers[input.kind] !== "function"
    )
      throw new ReportJobError("input", "报表任务处理器未注册");
    const request: ReportJobRequest = {
      kind: input.kind,
      payload: JSON.parse(
        serializeJobJson(input.payload, {
          maxNodes: 19_000,
          maxCharacters: 750_000,
        }),
      ) as ReportJobJson,
    };
    const previous = await get(input.scope, input.id);
    if (previous) {
      if (serializeJobJson(previous.request) !== serializeJobJson(request))
        throw new ReportJobError("conflict", "相同任务ID不能提交不同内容");
      return previous;
    }
    const archived = await archivedSubmission(options.store, input.scope, input.id, request);
    if (archived) return archived;
    const now = settings.now();
    const next: ReportJobRecord = {
      scope: input.scope,
      id: input.id,
      revision: 1,
      request,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      attempt: 0,
    };
    if (
      !(await options.store.compareAndSwap(input.scope, input.id, null, next))
    ) {
      const raced = await get(input.scope, input.id);
      if (
        raced &&
        serializeJobJson(raced.request) === serializeJobJson(request)
      )
        return raced;
      const retained = await archivedSubmission(options.store, input.scope, input.id, request);
      if (retained) return retained;
      throw new ReportJobError("conflict", "报表任务提交发生冲突");
    }
    return cloneJob(next);
  };
  const runNext: ReportJobService["runNext"] = (workerId) => {
    if (closed)
      return Promise.reject(new ReportJobError("closed", "报表任务服务已关闭"));
    if (active >= settings.concurrency)
      return Promise.reject(
        new ReportJobError("capacity", "报表任务执行槽位已满"),
      );
    active++;
    const controller = new AbortController();
    controllers.add(controller);
    const task = (async () => {
      try {
        const record = await claim(
          options,
          workerId,
          settings.leaseMs,
          settings.now(),
        );
        return record?.status === "running"
          ? await executeJob(options, settings, record, controller)
          : record;
      } finally {
        active--;
        controllers.delete(controller);
      }
    })();
    running.add(task);
    void task.then(
      () => running.delete(task),
      () => running.delete(task),
    );
    return task;
  };
  return {
    submit,
    get,
    runNext,
    get active() {
      return active;
    },
    cancel: async (scope, id) => {
      const record = await required(options.store, scope, id);
      if (record.status !== "queued" && record.status !== "running")
        return record;
      return mutate(options.store, record, {
        updatedAt: settings.now(),
        ...(record.status === "queued"
          ? { status: "cancelled" }
          : { cancelRequested: true }),
      });
    },
    retry: async (scope, id, revision) => {
      const record = await required(options.store, scope, id);
      if (record.revision !== revision || record.status !== "failed")
        throw new ReportJobError("conflict", "仅可重试当前修订的失败任务");
      const next = {
        ...record,
        status: "queued" as const,
        updatedAt: settings.now(),
      };
      delete next.error;
      delete next.progress;
      return mutate(options.store, record, next, ["error", "progress"]);
    },
    prune: async (input) => {
      if (!options.store.prune || !options.store.readTombstone) throw new ReportJobError("input", "当前任务适配器未实现可选终态保留能力");
      return options.store.prune({ ...input, now: settings.now() });
    },
    close: async () => {
      closed = true;
      for (const controller of controllers)
        controller.abort(new ReportJobError("closed", "任务服务正在关闭"));
      await Promise.allSettled([...running]);
    },
  };
}
