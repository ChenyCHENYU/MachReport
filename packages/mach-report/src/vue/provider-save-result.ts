import type { ReportSaveResult } from "@agile-team/mach-report";
import { MachReportError } from "./errors";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function diagnostics(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry: unknown) => record(entry)
    && typeof entry.code === "string" && typeof entry.message === "string"
    && ["info", "warning", "error"].includes(entry.severity as string)
    && (entry.path === undefined || typeof entry.path === "string"));
}

function conflicts(value: unknown, editCount: number): boolean {
  return Array.isArray(value) && value.every((entry: unknown) => record(entry)
    && Number.isSafeInteger(entry.editIndex) && (entry.editIndex as number) >= 0 && (entry.editIndex as number) < editCount
    && typeof entry.code === "string" && typeof entry.message === "string");
}

/** HTTP 适配器也可能返回包装体或非法元数据；不要让它们进入已显示的计划。 */
export function assertProviderSaveResult(value: unknown, editCount: number): asserts value is ReportSaveResult {
  let field: string | undefined;
  if (!record(value) || typeof value.revision !== "string" || !value.revision.trim()) field = "非空 revision（请先在适配器解包业务响应）";
  else if (value.sourceToken !== undefined && typeof value.sourceToken !== "string") field = "字符串 sourceToken";
  else if (value.diagnostics !== undefined && !diagnostics(value.diagnostics)) field = "结构化 diagnostics";
  else if (value.conflicts !== undefined && !conflicts(value.conflicts, editCount)) field = "有效 editIndex/code/message conflicts";
  if (field) throw new MachReportError("edit", `ReportProvider.save 必须返回${field}；服务器可能已提交，请重新查询确认后再编辑`);
}
