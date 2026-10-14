import { createReportSource } from "@agile-team/mach-report";
import type { ReportTemplate } from "@agile-team/mach-report";
import type { PlanFetcher } from "./adapters";
import { PlanLoadError } from "./adapters";

export interface LocalTemplateEntry {
  template: ReportTemplate;
  datasets?: Record<string, Record<string, unknown>[]>;
}

/**
 * 本地渲染适配器：模板 + 数据 → core 分页引擎 → RenderPlan。
 * 用于本地预览、离线场景和单测。
 */
export function createLocalFetcher(
  entries: Record<string, LocalTemplateEntry>
): PlanFetcher {
  const source = createReportSource(entries);
  const fetcher: PlanFetcher = async (input) => {
    // 保留本地 adapter 的旧错误类型与文案，其余编排复用统一数据源。
    if (input.reportIds.length === 0) throw new PlanLoadError("缺少报表 ID");
    for (const id of input.reportIds) {
      if (!Object.prototype.hasOwnProperty.call(entries, id) || !entries[id]) {
        throw new PlanLoadError(`本地模板 ${id} 不存在`);
      }
    }
    return source(input);
  };
  fetcher.getParamDefs = source.getParamDefs;
  return fetcher;
}
