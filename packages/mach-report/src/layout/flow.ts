import type { TemplateComponent } from "./paginate";

export interface ReportFlowBand {
  /** Exact stable component IDs. Static components use nid, lists use id. */
  componentIds: string[];
  /** Source-template coordinates; following bands keep their original gap. */
  topMm: number;
  heightMm: number;
}
export interface ReportPageFlow { bands: ReportFlowBand[] }
export interface ReportFlowGroup { components: TemplateComponent[]; band?: ReportFlowBand }

export function reportFlowComponentId(component: TemplateComponent): string | undefined {
  return component.kind === "list" ? component.id : component.nid;
}
function flowAnchor(component: TemplateComponent): boolean {
  if (component.kind === "list") return false;
  return component.pageAnchor !== undefined || component.kind === "text" && typeof component.text === "string" && /\{(?:page|totalPages)\}/.test(component.text);
}
function validateBandContents(components: TemplateComponent[], band: ReportFlowBand): void {
  const selected = components.filter(component => band.componentIds.includes(reportFlowComponentId(component) ?? ""));
  const repeats = selected.filter(component => component.kind === "list" && component.cardinality !== "record");
  if (repeats.length && selected.length !== 1) throw new Error("纵向重复区域必须独占流式分段，不能与静态或单记录区域并排");
  for (const component of selected) {
    const bottom = component.kind === "list" ? component.topMm + (component.rowHeightMm ?? 0) : component.topMm + component.heightMm;
    if (component.topMm < band.topMm - 0.001 || bottom > band.topMm + band.heightMm + 0.001) throw new Error("流式分段应完整包含其组件的原始纵向范围");
  }
}
/** Explicit bands avoid guessing whether two free-positioned components should move together. */
export function reportFlowGroups(components: TemplateComponent[], flow?: ReportPageFlow): ReportFlowGroup[] {
  if (!flow) return components.map(component => ({ components: [component] }));
  const byId = new Map(components.map(component => [reportFlowComponentId(component), component]));
  return flow.bands.map(band => ({ band, components: band.componentIds.map(id => {
    const component = byId.get(id);
    if (!component) throw new Error(`流式区域引用不存在的组件：${id}`);
    return component;
  }) }));
}
/** Runtime guard also protects callers that bypass persisted-template validation. */
export function validateReportPageFlow(components: TemplateComponent[], flow: ReportPageFlow): void {
  if (!flow || !Array.isArray(flow.bands) || !flow.bands.length || flow.bands.length > 10_000) throw new Error("流式排版应包含 1–10000 个区域");
  const expected = new Set<string>(), seen = new Set<string>();
  for (const component of components) {
    if (flowAnchor(component)) continue;
    const id = reportFlowComponentId(component);
    if (!id || expected.has(id)) throw new Error("流式排版组件应具有唯一标识");
    expected.add(id);
  }
  validateBands(components, flow, expected, seen);
  if (seen.size !== expected.size) throw new Error("流式排版必须显式包含每个非锚点组件");
}
function validateBands(components: TemplateComponent[], flow: ReportPageFlow, expected: Set<string>, seen: Set<string>): void {
  let previousBottom = -Infinity;
  for (const band of flow.bands) {
    if (!Number.isFinite(band.topMm) || !Number.isFinite(band.heightMm) || band.topMm < 0 || band.heightMm <= 0 || band.topMm < previousBottom - 0.001) throw new Error("流式区域应按原始位置排序，尺寸有效且不重叠");
    if (!Array.isArray(band.componentIds) || !band.componentIds.length) throw new Error("流式区域不能没有组件");
    for (const id of band.componentIds) {
      if (!expected.has(id) || seen.has(id)) throw new Error(`流式区域组件缺失、重复或包含页锚点：${id}`);
      seen.add(id);
    }
    validateBandContents(components, band);
    previousBottom = band.topMm + band.heightMm;
  }
}
