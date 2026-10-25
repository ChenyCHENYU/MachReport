import { snapshotReportJson } from "../schema/json-snapshot";
import { parseReportTemplate, REPORT_TEMPLATE_DOCUMENT_VERSION, type ReportTemplateDocument } from "./template-registry";

export interface ReportTemplateMigration {
  from: string;
  to: string;
  /** Pure document transformation; business data, credentials and I/O belong to the host. */
  migrate(input: Readonly<Record<string, unknown>>): unknown | Promise<unknown>;
}
export interface ReportTemplateMigrationResult { document: ReportTemplateDocument; steps: readonly { from: string; to: string }[] }
export class ReportTemplateMigrationError extends Error {
  constructor(readonly code: "definition" | "unsupported" | "result", message: string) { super(message); this.name = "ReportTemplateMigrationError"; }
}
function capture(input: unknown): Record<string, unknown> {
  let value = input;
  if (typeof value === "string") {
    if (value.length > 10_000_000) throw new ReportTemplateMigrationError("result", "模板迁移输入超过预算");
    try { value = JSON.parse(value); } catch { throw new ReportTemplateMigrationError("result", "模板 JSON 语法无效"); }
  }
  const snapshot = snapshotReportJson(value, { maxBytes: 10_000_000, error: (_code, message) => new ReportTemplateMigrationError("result", message) });
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new ReportTemplateMigrationError("result", "模板迁移应返回文档对象");
  return snapshot as Record<string, unknown>;
}
function migrationMap(steps: readonly ReportTemplateMigration[]): Map<string, ReportTemplateMigration> {
  if (!Array.isArray(steps) || steps.length > 32) throw new ReportTemplateMigrationError("definition", "模板迁移最多声明 32 步");
  const map = new Map<string, ReportTemplateMigration>();
  for (const step of steps) {
    if (!step || ![step.from, step.to].every(value => typeof value === "string" && value.trim() && value.length <= 64) || step.from === step.to || map.has(step.from) || typeof step.migrate !== "function" || step.from === REPORT_TEMPLATE_DOCUMENT_VERSION) throw new ReportTemplateMigrationError("definition", "迁移起点应唯一，不得从当前版本降级");
    map.set(step.from, { ...step });
  }
  for (const from of map.keys()) {
    const visited = new Set<string>(); let version = from;
    while (map.has(version)) {
      if (visited.has(version)) throw new ReportTemplateMigrationError("definition", "模板迁移链存在循环");
      visited.add(version); version = map.get(version)!.to;
    }
    if (version !== REPORT_TEMPLATE_DOCUMENT_VERSION) throw new ReportTemplateMigrationError("definition", "每条迁移链应到达当前模板版本");
  }
  return map;
}

/** Explicit, bounded migration chain. Unknown/future versions are never silently downgraded. */
export function createTemplateMigrator(steps: readonly ReportTemplateMigration[] = []): (input: unknown) => Promise<ReportTemplateMigrationResult> {
  const map = migrationMap(steps);
  return async input => {
    let document = capture(input);
    const applied: { from: string; to: string }[] = [];
    while (document.schemaVersion !== REPORT_TEMPLATE_DOCUMENT_VERSION) {
      const step = typeof document.schemaVersion === "string" ? map.get(document.schemaVersion) : undefined;
      if (!step) throw new ReportTemplateMigrationError("unsupported", "未声明此模板版本的迁移路径");
      const identity = document.id;
      const next = capture(await step.migrate(document));
      if (next.schemaVersion !== step.to || typeof identity === "string" && next.id !== identity) throw new ReportTemplateMigrationError("result", "迁移结果版本不匹配或改变了模板身份");
      applied.push({ from: step.from, to: step.to }); document = next;
    }
    return { document: parseReportTemplate(document), steps: applied };
  };
}
