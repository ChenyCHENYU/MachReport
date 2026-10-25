import type { PlanComponent } from "../schema/render-plan";
import { chartComponentUpperBound, createChartComponents, type ReportChartOptions } from "../processing/charts";
import { createReportChartData } from "../processing/chart-data";
import type { DatasetRows } from "./paginate";
import { PaginateChartComponentLimitError } from "./pagination-errors";

export const DEFAULT_CHART_COMPONENT_LIMIT = 50_000;
export interface ChartComponentResolver {
  (component: PlanComponent): PlanComponent[];
  used(): number;
}

export function validateChartComponentLimit(limit = DEFAULT_CHART_COMPONENT_LIMIT): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000) throw new RangeError("maxChartComponents 应为 1..1000000 的安全整数");
}

function boundChartOptions(component: PlanComponent, datasets: DatasetRows, signal?: AbortSignal): ReportChartOptions {
  const binding = component.chartBinding!;
  if (component.kind !== "chart" || component.grid || component.imageData || component.binding || component.pageAnchor) throw new TypeError("绑定图表不能同时设置图片、网格、记录绑定或页眉页脚");
  const rows = Object.prototype.hasOwnProperty.call(datasets, binding.dataset) ? datasets[binding.dataset] : undefined;
  if (!Array.isArray(rows)) throw new TypeError(`图表数据集 ${binding.dataset} 未提供`);
  const data = createReportChartData(rows, binding, signal);
  return { ...data, type: binding.type, leftMm: component.leftMm, topMm: component.topMm, widthMm: component.widthMm, heightMm: component.heightMm, title: binding.title, showValues: binding.showValues };
}

/** One pagination pass shares this budget across template and flow continuation pages. */
export function createChartResolver(datasets: DatasetRows, signal?: AbortSignal, limit = DEFAULT_CHART_COMPONENT_LIMIT): ChartComponentResolver {
  validateChartComponentLimit(limit);
  let used = 0;
  const resolve = (component: PlanComponent) => {
    if (!component.chartBinding) return [component];
    const options = boundChartOptions(component, datasets, signal);
    const estimated = used + (options.categories.length ? chartComponentUpperBound(options) : 1);
    if (!Number.isSafeInteger(estimated)) throw new RangeError("图表图元估算应为有限安全整数");
    if (estimated > limit) throw new PaginateChartComponentLimitError(limit, estimated);
    const result = options.categories.length ? createChartComponents(options) : [{ kind: "text" as const, leftMm: component.leftMm, topMm: component.topMm, widthMm: component.widthMm, heightMm: component.heightMm, text: "—", style: { align: "center" as const, verticalAlign: "middle" as const, color: "#94a3b8", fontSize: 10 } }];
    used += result.length;
    return result;
  };
  return Object.assign(resolve, { used: () => used });
}
