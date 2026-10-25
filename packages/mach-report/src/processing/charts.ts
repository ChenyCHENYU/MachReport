import type { PlanComponent } from "../schema/render-plan";
import { chartArray } from "./chart-input";

export interface ReportChartSeries { name: string; values: readonly (number | null)[]; color?: string }
export interface ReportChartOptions {
  type: "bar" | "line" | "stackedBar" | "percentBar";
  categories: readonly string[];
  series: readonly ReportChartSeries[];
  leftMm: number; topMm: number; widthMm: number; heightMm: number;
  title?: string;
  showValues?: boolean;
}
const COLORS = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#dc2626", "#0284c7"];

function checked(options: ReportChartOptions): ReportChartOptions {
  if (!["bar", "line", "stackedBar", "percentBar"].includes(options.type)) throw new Error("未知图表类型");
  if (!Array.isArray(options.categories) || !Array.isArray(options.series) || !options.categories.length || options.categories.length > 200 || !options.series.length || options.series.length > 12) throw new Error("图表支持 1–200 个分类、1–12 个系列；大数据应先聚合");
  const categories = chartArray(options.categories, 200, "图表分类");
  const series = chartArray(options.series, 12, "图表系列").map(item => ({ ...item, values: chartArray(item?.values, 200, "图表数值") }));
  for (const category of categories) if (typeof category !== "string") throw new Error("图表分类应为字符串");
  checkedGeometry(options);
  for (const item of series) checkedSeries(item, categories.length);
  return { ...options, categories, series };
}
function checkedGeometry(options: ReportChartOptions): void {
  for (const key of ["leftMm", "topMm", "widthMm", "heightMm"] as const) {
    if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`${key} 应为有限非负数`);
  }
  if (options.widthMm < 45 || options.heightMm < 35) throw new Error("图表至少需要 45×35mm");
  if (!Number.isFinite(options.leftMm + options.widthMm) || !Number.isFinite(options.topMm + options.heightMm)) throw new Error("图表几何范围溢出");
}
function checkedSeries(series: ReportChartSeries, count: number): void {
  if (!series || typeof series.name !== "string" || !Array.isArray(series.values) || series.values.length !== count) throw new Error("图表系列应提供名称及逐分类的有限数字或 null");
  for (const value of series.values) if (value !== null && !Number.isFinite(value)) throw new Error("图表系列应提供名称及逐分类的有限数字或 null");
  if (series.color !== undefined && !/^#[\da-f]{6}$/i.test(series.color)) throw new Error("图表颜色应为 #RRGGBB");
}

function line(x1: number, y1: number, x2: number, y2: number, color: string, width = 0.8): PlanComponent {
  return { kind: "line", leftMm: Math.min(x1, x2), topMm: Math.min(y1, y2), widthMm: Math.abs(x2 - x1), heightMm: Math.abs(y2 - y1), lineDirection: y2 < y1 ? "up" : "down", style: { lineColor: color, lineWidthPt: width } };
}
function text(value: string, leftMm: number, topMm: number, widthMm: number, align: "left" | "center" | "right" = "center"): PlanComponent {
  return { kind: "text", text: value, leftMm, topMm, widthMm, heightMm: 5, style: { fontSize: 8, color: "#475569", align, verticalAlign: "middle" } };
}
function numberLabel(value: number): string { return Number(value.toPrecision(5)).toString(); }

interface ChartSpace { left: number; top: number; width: number; height: number; min: number; max: number; y(value: number): number }
function space(options: ReportChartOptions): ChartSpace {
  let min = 0, max = 0;
  const bounds = stacked(options) ? stackBounds(options) : undefined;
  if (bounds) { min = bounds.min; max = bounds.max; }
  else for (const series of options.series) for (const value of series.values) if (value !== null) { min = Math.min(min, value); max = Math.max(max, value); }
  if (min === max) max = min + 1;
  const left = options.leftMm + 13, top = options.topMm + 8, width = options.widthMm - 17, height = options.heightMm - 23;
  const scale = Math.max(Math.abs(min), Math.abs(max), 1), normalizedMin = min / scale;
  const span = max / scale - normalizedMin;
  return { left, top, width, height, min, max, y: (value) => top + height * (1 - (value / scale - normalizedMin) / span) };
}

function stacked(options: ReportChartOptions): boolean { return options.type === "stackedBar" || options.type === "percentBar"; }
function stackBounds(options: ReportChartOptions): { min: number; max: number } {
  let min = 0, max = options.type === "percentBar" ? 100 : 0;
  for (let index = 0; index < options.categories.length; index++) {
    let positive = 0, negative = 0;
    for (const series of options.series) {
      const value = series.values[index] ?? 0;
      if (value < 0) negative += value; else positive += value;
    }
    if (!Number.isFinite(positive) || !Number.isFinite(negative)) throw new Error("图表堆叠合计溢出，请先明确缩放单位");
    min = Math.min(min, negative); max = Math.max(max, positive);
  }
  return { min, max };
}
function percentageOptions(options: ReportChartOptions): ReportChartOptions {
  if (options.type !== "percentBar") return options;
  const totals = options.categories.map((_, index) => {
    let scale = 0;
    for (const series of options.series) {
      const value = series.values[index];
      if (value !== null && value! < 0) throw new Error("占比图需要非负度量，负数口径应由业务明确处理");
      scale = Math.max(scale, value ?? 0);
    }
    return { scale, total: scale ? options.series.reduce((sum, series) => sum + (series.values[index] ?? 0) / scale, 0) : 0 };
  });
  return { ...options, series: options.series.map(series => ({ ...series, values: series.values.map((value, index) => {
    if (value === null) return null;
    const { scale, total } = totals[index]!;
    return scale && total ? (value / scale) / total * 100 : 0;
  }) })) };
}
function stackComponents(options: ReportChartOptions, plot: ChartSpace): PlanComponent[] {
  const result: PlanComponent[] = [], categoryWidth = plot.width / options.categories.length;
  options.categories.forEach((_, index) => {
    let positive = 0, negative = 0;
    options.series.forEach((series, seriesIndex) => {
      const value = series.values[index]; if (value === null || value === undefined) return;
      const from = value < 0 ? negative : positive, to = from + value;
      if (value < 0) negative = to; else positive = to;
      const top = Math.min(plot.y(from), plot.y(to)), height = Math.abs(plot.y(to) - plot.y(from)), color = series.color ?? COLORS[seriesIndex % COLORS.length]!;
      const left = plot.left + categoryWidth * (index + .15), width = categoryWidth * .7;
      result.push({ kind: "rect", leftMm: left, topMm: top, widthMm: width, heightMm: height, style: { backgroundColor: color, borderTop: false, borderRight: false, borderBottom: false, borderLeft: false } });
      if (options.showValues && height >= 5) result.push({ ...text(options.type === "percentBar" ? `${numberLabel(value)}%` : numberLabel(value), left, top + height / 2 - 2.5, width), style: { fontSize: 7, color: "#ffffff", align: "center" } });
    });
  });
  return result;
}

function axis(options: ReportChartOptions, plot: ChartSpace): PlanComponent[] {
  const components: PlanComponent[] = [];
  if (options.title) components.push({ ...text(options.title, options.leftMm, options.topMm, options.widthMm), style: { fontSize: 10, bold: true, align: "left" } });
  for (let tick = 0; tick <= 4; tick++) {
    const fraction = tick / 4, value = plot.min * (1 - fraction) + plot.max * fraction, y = plot.y(value);
    components.push(line(plot.left, y, plot.left + plot.width, y, "#e2e8f0", 0.4), text(`${numberLabel(value)}${options.type === "percentBar" ? "%" : ""}`, options.leftMm, y - 2.5, 11, "right"));
  }
  components.push(line(plot.left, plot.top, plot.left, plot.top + plot.height, "#94a3b8"));
  const step = Math.max(1, Math.ceil(options.categories.length / Math.max(1, Math.floor(plot.width / 14))));
  options.categories.forEach((category, index) => {
    if (index % step === 0) components.push(text(category, plot.left + (index + 0.5) * plot.width / options.categories.length - 7, plot.top + plot.height + 1, 14));
  });
  const legendWidth = plot.width / options.series.length;
  options.series.forEach((series, index) => {
    components.push({ ...text(series.name, plot.left + index * legendWidth, options.topMm + options.heightMm - 5, legendWidth), style: { fontSize: 8, color: series.color ?? COLORS[index % COLORS.length], align: "center" } });
  });
  return components;
}

function seriesComponents(options: ReportChartOptions, plot: ChartSpace, series: ReportChartSeries, seriesIndex: number): PlanComponent[] {
  const components: PlanComponent[] = [];
  const color = series.color ?? COLORS[seriesIndex % COLORS.length]!;
  const categoryWidth = plot.width / options.categories.length;
  const barWidth = categoryWidth * 0.75 / options.series.length;
  let previous: { x: number; y: number } | undefined;
  series.values.forEach((value, index) => {
    if (value === null) { previous = undefined; return; }
    const x = plot.left + (index + 0.5) * categoryWidth, y = plot.y(value);
    if (options.type === "bar") {
      components.push({ kind: "rect", leftMm: plot.left + index * categoryWidth + categoryWidth * 0.125 + seriesIndex * barWidth, topMm: Math.min(y, plot.y(0)), widthMm: barWidth, heightMm: Math.abs(plot.y(0) - y), style: { backgroundColor: color, borderTop: false, borderRight: false, borderBottom: false, borderLeft: false } });
    } else {
      if (previous) components.push(line(previous.x, previous.y, x, y, color, 1.2));
      components.push({ kind: "ellipse", leftMm: x - 0.7, topMm: y - 0.7, widthMm: 1.4, heightMm: 1.4, style: { backgroundColor: color, borderColor: color } });
      previous = { x, y };
    }
    if (options.showValues) components.push({ ...text(numberLabel(value), x - categoryWidth / 2, Math.max(plot.top, y - 5), categoryWidth), style: { fontSize: 7, color, align: "center" } });
  });
  return components;
}

function seriesComponentBound(options: ReportChartOptions, series: ReportChartSeries): number {
  let count = 0, previous = false;
  for (const value of series.values) {
    if (value === null) { previous = false; continue; }
    count += 1 + Number(!!options.showValues);
    if (options.type === "line" && previous) count++;
    previous = true;
  }
  return count;
}

/** Internal preallocation bound for aggregated, bounded inputs; stacked value labels may be omitted. */
export function chartComponentUpperBound(options: ReportChartOptions): number {
  const count = options.categories.length;
  const step = Math.max(1, Math.ceil(count / Math.max(1, Math.floor((options.widthMm - 17) / 14))));
  const axisCount = 11 + Number(!!options.title) + Math.ceil(count / step) + options.series.length;
  return options.series.reduce((total, series) => total + seriesComponentBound(options, series), axisCount);
}

/** 轻量柱/折线图展开为共用基础图元，无外部图表依赖，DOM/Canvas/PDF 使用同一计划。 */
export function createChartComponents(options: ReportChartOptions): PlanComponent[] {
  options = percentageOptions(checked(options));
  const plot = space(options);
  return [...axis(options, plot), ...(stacked(options) ? stackComponents(options, plot) : options.series.flatMap((series, index) => seriesComponents(options, plot, series, index)))];
}
