import { createAggregateAccumulator, type AggregateAccumulator, type AggregateRequest } from "./aggregate";
import { computationFieldName } from "./expressions";
import type { ReportChartOptions, ReportChartSeries } from "./charts";
import { chartArray } from "./chart-input";

export interface ReportChartMeasure extends AggregateRequest { label?: string; color?: string }
/** Serializable binding; data and authorization continue to come from the existing report source. */
export interface ReportChartBinding {
  dataset: string;
  categoryField: string;
  measures: readonly ReportChartMeasure[];
  type: ReportChartOptions["type"];
  sort?: "asc" | "desc";
  title?: string;
  showValues?: boolean;
  maxRows?: number;
  maxCategories?: number;
}
export interface ReportChartData { categories: string[]; series: ReportChartSeries[] }
function limit(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) throw new RangeError("图表预算超出允许范围");
  return Number(value);
}
export function validateReportChartBinding(binding: ReportChartBinding): void {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new TypeError("图表绑定应为对象");
  computationFieldName(binding.dataset); computationFieldName(binding.categoryField);
  if (!["bar", "line", "stackedBar", "percentBar"].includes(binding.type)) throw new TypeError("图表类型无效");
  if (binding.sort !== undefined && !["asc", "desc"].includes(binding.sort)) throw new TypeError("图表排序无效");
  if (binding.title !== undefined && (typeof binding.title !== "string" || binding.title.length > 512)) throw new TypeError("图表标题过长");
  if (binding.showValues !== undefined && typeof binding.showValues !== "boolean") throw new TypeError("图表数值标签应为布尔值");
  if (!Array.isArray(binding.measures) || !binding.measures.length || binding.measures.length > 12) throw new RangeError("图表支持 1–12 个度量");
  for (const measure of chartArray(binding.measures, 12, "图表度量")) validateMeasure(measure);
  limit(binding.maxRows, 100_000, 100_000); limit(binding.maxCategories, 200, 200);
}
function validateMeasure(measure: ReportChartMeasure): void {
  if (!measure || typeof measure !== "object" || Array.isArray(measure)) throw new TypeError("图表度量应为对象");
  if (measure.field !== undefined) computationFieldName(measure.field);
  if (measure.weightField !== undefined) computationFieldName(measure.weightField);
  if (measure.label !== undefined && (typeof measure.label !== "string" || measure.label.length > 256)) throw new TypeError("图表系列名称过长");
  if (measure.color !== undefined && !/^#[\da-f]{6}$/i.test(measure.color)) throw new TypeError("图表颜色应为 #RRGGBB");
  createAggregateAccumulator(measure);
}
function category(value: unknown): { key: string; label: string } {
  if (value === null || value === undefined) return { key: "null", label: "—" };
  if (typeof value !== "string" && typeof value !== "boolean" && !(typeof value === "number" && Number.isFinite(value))) throw new TypeError("图表分类应为文本、布尔或有限数字");
  const label = String(value);
  if (label.length > 512) throw new RangeError("图表分类名称过长");
  return { key: JSON.stringify([typeof value, value]), label };
}
function plotValue(value: number | string | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError("聚合结果超出图表有限数值范围");
  return number;
}
/** One bounded scan, shared aggregate semantics; labels never coerce identifier source values. */
export function createReportChartData(rows: readonly Record<string, unknown>[], binding: ReportChartBinding, signal?: AbortSignal): ReportChartData {
  if (signal?.aborted) { const error = new Error("图表数据处理已取消"); error.name = "AbortError"; throw error; }
  validateReportChartBinding(binding);
  const measures = chartArray(binding.measures, 12, "图表度量");
  if (!Array.isArray(rows) || rows.length > limit(binding.maxRows, 100_000, 100_000)) throw new RangeError("图表数据超出行数预算");
  const groups = new Map<string, { label: string; accumulators: AggregateAccumulator[] }>();
  const maximum = limit(binding.maxCategories, 200, 200);
  for (let index = 0; index < rows.length; index++) {
    if (signal?.aborted) { const error = new Error("图表数据处理已取消"); error.name = "AbortError"; throw error; }
    const row = rows[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError("图表数据行应为对象");
    const key = category(Object.prototype.hasOwnProperty.call(row, binding.categoryField) ? row[binding.categoryField] : null);
    let group = groups.get(key.key);
    if (!group) {
      if (groups.size >= maximum) throw new RangeError("图表分类超出预算，请明确筛选或聚合数据");
      group = { label: key.label, accumulators: measures.map(createAggregateAccumulator) }; groups.set(key.key, group);
    }
    group.accumulators.forEach(accumulator => accumulator.add(row));
  }
  const entries = [...groups.values()];
  if (binding.sort) entries.sort((a, b) => (binding.sort === "desc" ? -1 : 1) * (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return { categories: entries.map(entry => entry.label), series: measures.map((measure, index) => ({
    name: measure.label ?? `${measure.field ?? "记录"} · ${measure.op}`, values: entries.map(entry => plotValue(entry.accumulators[index]!.value())), ...(measure.color ? { color: measure.color } : {})
  })) };
}
