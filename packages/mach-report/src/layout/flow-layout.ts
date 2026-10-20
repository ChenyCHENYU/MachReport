import type { PlanComponent, PlanPage } from "../schema/render-plan";
import type { ListComponent, TemplatePage } from "./paginate";
import { reportFlowGroups, validateReportPageFlow } from "./flow";

export interface ReportFlowPlacement {
  page: TemplatePage;
  active(): void;
  top(): number;
  bottom(): number;
  append(component: PlanComponent): void;
  nextPage(): void;
  takePages(): PlanPage[];
  height(component: ListComponent): number;
  list(component: ListComponent, top: number, finished: (bottom: number) => void): Generator<PlanPage>;
}

/** Vertical flow is explicit. Free-positioned legacy pages keep their existing layout. */
export function* paginateFlowPage(context: ReportFlowPlacement): Generator<PlanPage> {
  const { page } = context;
  validateReportPageFlow(page.components, page.flow!);
  let sourceBottom = 0, actualBottom = 0;
  for (const group of reportFlowGroups(page.components, page.flow)) {
    context.active();
    const band = group.band!;
    const repeat = group.components.some(component => component.kind === "list" && component.cardinality !== "record");
    const height = repeat ? 0 : group.components.reduce((maximum, component) => Math.max(maximum, component.topMm - band.topMm + (component.kind === "list" ? context.height(component) : component.heightMm)), band.heightMm);
    let top = Math.max(context.top(), actualBottom + band.topMm - sourceBottom);
    if (!repeat && height > context.bottom() - context.top() + 0.001) throw new Error(`静态区域 ${band.componentIds.join(",")} 高度超出单页可用范围`);
    if (!repeat && top + height > context.bottom() + 0.001) {
      context.nextPage(); yield* context.takePages(); context.active(); top = context.top();
    }
    let end = top + height;
    for (const component of group.components) {
      const offsetTop = top + component.topMm - band.topMm;
      if (component.kind === "list") { yield* context.list(component, offsetTop, bottom => { end = repeat ? bottom : Math.max(end, bottom); }); context.active(); }
      else context.append({ ...component, topMm: offsetTop });
    }
    actualBottom = end;
    sourceBottom = band.topMm + band.heightMm;
  }
}
