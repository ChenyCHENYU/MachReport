import { paginateTemplate } from "@agile-team/mach-report";
import type { ReportTemplate } from "@agile-team/mach-report";
import type { PlanFetcher } from "./adapters";
import { PlanLoadError } from "./adapters";

export interface LocalTemplateEntry {
  tempId: string;
  template: ReportTemplate;
  datasets?: Record<string, Record<string, unknown>[]>;
}

/**
 * 本地渲染适配器：模板 + 数据 → core 分页引擎 → RenderPlan。
 * 用于离线预览、单测与 jh4j 后端不可用场景（单真相源验证）。
 */
export function createLocalFetcher(
  entries: Record<string, LocalTemplateEntry>
): PlanFetcher {
  return async ({ tempIds }) => {
    if (tempIds.length === 0) throw new PlanLoadError("缺少报表模板 ID");
    const allPages = [];
    for (const id of tempIds) {
      const entry = entries[id];
      if (!entry) throw new PlanLoadError(`本地模板 ${id} 不存在`);
      const { plan, warnings } = paginateTemplate(entry.template, entry.datasets ?? {});
      if (warnings.length > 0) {
        console.warn("[mach-report] 分页告警:", warnings);
      }
      allPages.push(...plan.pages);
    }
    return { schemaVersion: "mach-local", pages: allPages };
  };
}
