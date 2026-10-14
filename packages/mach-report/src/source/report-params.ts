import type { ReportParamDef } from "../layout/paginate";
import type { ReportRegistry } from "./report-source";

/** 轻量元数据读取；插件首次注册时不需要加载分页或渲染实现。 */
export function getReportParamDefs(reports: ReportRegistry, ids: string[]): ReportParamDef[] {
  const fields = new Set<string>();
  return ids.flatMap((id) => {
    const definition = Object.prototype.hasOwnProperty.call(reports, id) ? reports[id] : undefined;
    const params = definition?.params ?? (typeof definition?.template === "function" ? [] : definition?.template.params) ?? [];
    return params.filter((param) => {
      if (fields.has(param.field)) return false;
      fields.add(param.field);
      return true;
    });
  });
}
