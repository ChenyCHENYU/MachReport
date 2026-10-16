import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createTableTemplate } from "@agile-team/mach-report";
import { createReportRuntime, createReportTaskQueue } from "@agile-team/mach-report/server";

/** 标准库参考适配器；生产宿主在路由前接入自己的认证、授权和数据提供器。 */
export function createExampleServer() {
  const template = createTableTemplate({ title: "Precision report", columns: [
    { field: "id", header: "ID", semanticRole: "identifier" },
    { field: "amount", header: "Exact decimal", semanticRole: "text" },
    { field: "quantity", header: "Quantity", semanticRole: "measure" }
  ] });
  template.params = [
    { field: "plant", required: true, maxLength: 12 },
    { field: "reportDate", type: "date", required: true },
    { field: "delayMs", type: "number", min: 0, max: 5000 }
  ];
  const reports = { sample: { template, dataSchema: { detail: { rowKey: "id", fields: [
    { field: "id", type: "text", required: true, semanticRole: "identifier" },
    { field: "amount", type: "decimal", required: true, semanticRole: "measure" },
    { field: "quantity", type: "number", required: true, semanticRole: "measure" }
  ] } }, provider: { query: async ({ params, signal }) => {
    if (params.delayMs) await delay(Number(params.delayMs), undefined, { signal });
    return { datasets: { detail: [{ id: "0001", amount: "12345678901234567890.123456", quantity: 0 }] }, revision: "fixture-1", sourceToken: "fixture-source-1" };
  } } } };
  const runtime = createReportRuntime({ reports, budget: { maxRows: 1000, maxPages: 100, maxOutputBytes: 2_000_000, maxDurationMs: 1000 } });
  const queue = createReportTaskQueue({ concurrency: 2, maxQueued: 4 });
  const counts = { completed: 0, cancelled: 0, failed: 0 };
  const server = createServer((request, response) => {
    const controller = new AbortController();
    const correlationId = safeCorrelationId(request.headers["x-request-id"]);
    response.setHeader("x-request-id", correlationId);
    // 正常end后的close不触发取消；客户端断开则取消排队、取数和运行时任务。
    response.on("close", () => { if (!response.writableEnded) controller.abort("client disconnected"); });
    void handle(request, response, controller.signal, correlationId).catch((error) => {
      if (controller.signal.aborted) { counts.cancelled++; return; }
      counts.failed++;
      const code = typeof error.code === "string" ? error.code : error.name === "AbortError" ? "cancelled" : "internal";
      const status = { params: 422, validate: 422, fetch: 502, config: 400, budget: 413, timeout: 504, "queue-full": 429, closed: 503, cancelled: 499, "output-fidelity": 422 }[code] ?? 500;
      json(response, status, { error: { code, message: code === "internal" ? "Report execution failed" : error.message, correlationId, ...(Array.isArray(error.issues) ? { issues: error.issues } : {}), ...(error.path ? { path: error.path } : {}) } });
    });
  });
  async function handle(request, response, signal, correlationId) {
    const path = new URL(request.url, "http://localhost").pathname;
    if (request.method === "GET" && path === "/health") return json(response, 200, { status: "ok", active: queue.active, pending: queue.pending, heapUsedBytes: process.memoryUsage().heapUsed, ...counts });
    if (request.method === "GET" && path === "/reports") return json(response, 200, runtime.describe());
    const route = /^\/reports\/sample\/(prepare|export\/(pdf|xlsx))$/.exec(path);
    if (request.method !== "POST" || !route) return json(response, 404, { error: { code: "not-found", message: "Unknown report route", correlationId } });
    const body = await readJson(request);
    const params = paramsFrom(body);
    const task = queue.enqueue(({ taskId, signal: taskSignal, onEvent }) => {
      const input = { reportIds: ["sample"], params, taskId, correlationId, signal: taskSignal, onEvent };
      return route[1] === "prepare" ? runtime.prepare(input) : runtime.export({ ...input, format: route[2] });
    }, { signal });
    const result = await task.result;
    if (signal.aborted || response.destroyed) return;
    counts.completed++;
    if ("bytes" in result) {
      response.writeHead(200, { "content-type": result.contentType, "content-disposition": `attachment; filename="sample.${result.format}"`, "content-length": result.bytes.byteLength, "x-report-revision": result.revisions.sample?.revision ?? "" });
      response.end(result.bytes);
    } else json(response, 200, result);
  }
  server.on("close", () => queue.close({ cancelRunning: true }));
  return server;
}
function safeCorrelationId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value) ? value : `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function json(response, status, value) {
  if (response.destroyed) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value));
}
function paramsFrom(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !body.params || typeof body.params !== "object" || Array.isArray(body.params)) throw Object.assign(new Error("Expected params object"), { code: "params" });
  const entries = Object.entries(body.params);
  if (entries.some(([key, value]) => !["plant", "reportDate", "delayMs"].includes(key) || typeof value !== "string")) throw Object.assign(new Error("Unknown parameter or non-string parameter value"), { code: "params" });
  return Object.fromEntries(entries);
}
async function readJson(request) {
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16_384) throw Object.assign(new Error("Request exceeds 16 KiB"), { code: "budget" });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid JSON request"), { code: "params" }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createExampleServer();
  server.listen(Number(process.env.PORT ?? 8620), "127.0.0.1", () => console.log(`MachReport reference server: http://127.0.0.1:${server.address().port}`));
}
