import type { ReportDescription } from "./types";

export const REPORT_HTTP_CONTRACT_VERSION = "1.0";
export interface ReportHttpErrorBody {
  error: { code: string; message: string; correlationId: string; path?: string; issues?: Record<string, string>[] };
}
const STATUSES: Readonly<Record<string, number>> = Object.freeze({ params: 422, validate: 422, fetch: 502, config: 400, input: 400, budget: 413, capacity: 413, timeout: 504, "queue-full": 429, closed: 503, cancelled: 499, "output-fidelity": 422, conflict: 409, missing: 404 });
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function errorIssues(value: unknown): Record<string, string>[] | undefined {
  if (!Array.isArray(value)) return;
  return value.slice(0, 100).map(issue => Object.fromEntries(["code", "path", "field", "message"].flatMap(key => typeof record(issue)[key] === "string" ? [[key, (record(issue)[key] as string).slice(0, 4096)]] : [])));
}
/** Stable transport mapping; unexpected errors never expose exception details or stacks. */
export function reportHttpError(error: unknown, correlationId: string): { status: number; body: ReportHttpErrorBody } {
  const value = record(error), requested = value.name === "AbortError" ? "cancelled" : value.code;
  const code = typeof requested === "string" && Object.prototype.hasOwnProperty.call(STATUSES, requested) ? requested : "internal";
  const issues = code === "internal" ? undefined : errorIssues(value.issues ?? record(value.cause).issues);
  return { status: STATUSES[code] ?? 500, body: { error: {
    code, message: code === "internal" ? "Report execution failed" : typeof value.message === "string" ? value.message.slice(0, 4096) : "Report request failed",
    correlationId: correlationId.slice(0, 128),
    ...(code !== "internal" && typeof value.path === "string" ? { path: value.path.slice(0, 4096) } : {}), ...(issues ? { issues } : {})
  } } };
}
function response(contentType: string, schema: Record<string, unknown>, description: string): Record<string, unknown> {
  return { description, headers: { "X-Request-Id": { schema: { type: "string" }, description: "Request correlation identity" } }, content: { [contentType]: { schema } } };
}
function wireParams(description: ReportDescription): Record<string, unknown> {
  return { type: "object", additionalProperties: false,
    properties: Object.fromEntries(description.params.map(param => [param.field, { type: "string" }])),
    required: description.params.filter(param => param.required && param.defaultValue === undefined).map(param => param.field),
    "x-report-typedSchema": description.paramsSchema
  };
}
/** OpenAPI 3.1 for the minimal Java/Node wire contract. Host registers routes and authorizes IDs before describe(). */
export function createReportOpenApi(descriptions: readonly ReportDescription[], options: { title?: string; version?: string; basePath?: string } = {}): Record<string, unknown> {
  const base = options.basePath ?? "/reports";
  if (!/^\/[A-Za-z0-9/_-]*[A-Za-z0-9_-]$/.test(base)) throw new Error("OpenAPI basePath 应为不含查询串、参数和尾斜线的绝对路径");
  const paths: Record<string, unknown> = {
    [base]: { get: { operationId: "describeReports", responses: { "200": response("application/json", { type: "array", items: { type: "object" } }, "Authorized report descriptions") } } }
  };
  const ids = new Set<string>();
  for (const description of descriptions) {
    if (!description.id.trim() || ids.has(description.id) || [".", ".."].includes(description.id)) throw new Error("OpenAPI 报表 ID 应非空、唯一且不是路径跳转段");
    ids.add(description.id);
    for (const format of ["prepare", "pdf", "xlsx"] as const) {
      const suffix = format === "prepare" ? "prepare" : `export/${format}`;
      const binary = format !== "prepare";
      const responses: Record<string, unknown> = { "200": response(binary ? format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/json", binary ? { type: "string", format: "binary" } : { type: "object", required: ["plan", "stats", "diagnostics", "revisions"] }, binary ? "Report file" : "Prepared report snapshot") };
      for (const status of [400, 413, 422, 429, 499, 500, 502, 503, 504]) responses[String(status)] = response("application/json", { $ref: "#/components/schemas/ReportError" }, "Structured report error");
      paths[`${base}/${encodeURIComponent(description.id)}/${suffix}`] = { post: {
        operationId: `report_${ids.size}_${format}`, parameters: [{ in: "header", name: "X-Request-Id", schema: { type: "string", pattern: "^[A-Za-z0-9._-]{1,80}$" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["params"], additionalProperties: false, properties: { params: wireParams(description) } } } } },
        responses, "x-report-datasets": description.datasetsSchema
      } };
    }
  }
  return { openapi: "3.1.0", info: { title: options.title ?? "MachReport HTTP", version: options.version ?? REPORT_HTTP_CONTRACT_VERSION }, paths,
    components: { schemas: { ReportError: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message", "correlationId"], properties: { code: { type: "string" }, message: { type: "string" }, correlationId: { type: "string" }, path: { type: "string" }, issues: { type: "array", items: { type: "object", additionalProperties: { type: "string" } } } } } } } } }
  };
}
