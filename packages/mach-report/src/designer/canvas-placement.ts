import type {
  ReportTemplateDocument,
  TemplateComponent,
  TemplatePage,
} from "@agile-team/mach-report";
import {
  componentGeometry,
  constrainGeometry,
  setCanvasGeometry,
  type CanvasGeometry,
} from "./canvas-commands";

const GAP = 2;
function overlaps(a: CanvasGeometry, b: CanvasGeometry): boolean {
  return (
    a.leftMm < b.leftMm + b.widthMm + GAP &&
    a.leftMm + a.widthMm + GAP > b.leftMm &&
    a.topMm < b.topMm + b.heightMm + GAP &&
    a.topMm + a.heightMm + GAP > b.topMm
  );
}
function bounds(page: TemplatePage) {
  return {
    left: page.marginLeftMm ?? 2,
    top: page.marginTopMm ?? 2,
    right: page.widthMm - (page.marginRightMm ?? 2),
    bottom: page.heightMm - (page.marginBottomMm ?? 2),
  };
}
/** 有界候选落点避让现有对象，空间不足时新增同尺寸版面，整个插入仍是一笔事务。 */
export function placeCanvasComponent(
  document: ReportTemplateDocument,
  pageIndex: number,
  component: TemplateComponent,
): { pageIndex: number; newPage: boolean } {
  const page = document.template.pages[pageIndex]!;
  const limit = bounds(page),
    geometry = componentGeometry(component);
  geometry.widthMm = Math.min(
    geometry.widthMm,
    Math.max(2, limit.right - limit.left),
  );
  geometry.heightMm = Math.min(
    geometry.heightMm,
    Math.max(2, limit.bottom - limit.top),
  );
  if (component.kind === "qrcode")
    geometry.widthMm = geometry.heightMm = Math.min(
      geometry.widthMm,
      geometry.heightMm,
    );
  const dynamic = page.components.some(item => item.kind === "list");
  // A three-row canvas sample does not bound a dynamic list's final extent.
  // Reserve its remaining band, including future rows and generated matrix columns.
  const occupied = page.components.map(item => item.kind === "list"
    ? { leftMm: limit.left, topMm: item.topMm, widthMm: limit.right - limit.left, heightMm: Math.max(0, limit.bottom - item.topMm) }
    : componentGeometry(item));
  const candidates = [{ leftMm: limit.left, topMm: limit.top }];
  for (const box of occupied.slice(0, 250)) {
    candidates.push({
      leftMm: box.leftMm + box.widthMm + GAP,
      topMm: box.topMm,
    });
    candidates.push({
      leftMm: limit.left,
      topMm: box.topMm + box.heightMm + GAP,
    });
  }
  candidates.sort((a, b) => a.topMm - b.topMm || a.leftMm - b.leftMm);
  const free = candidates.find((point) => {
    const next = { ...geometry, ...point };
    return (
      next.leftMm >= limit.left &&
      next.topMm >= limit.top &&
      next.leftMm + next.widthMm <= limit.right &&
      next.topMm + next.heightMm <= limit.bottom &&
      !occupied.some((box) => overlaps(next, box))
    );
  });
  if (free) {
    setCanvasGeometry(component, { ...geometry, ...free });
    page.components.push(component);
    return { pageIndex, newPage: false };
  }
  if (page.layout === "wide" && !dynamic) {
    const topMm = Math.max(
      limit.top,
      ...occupied.map((box) => box.topMm + box.heightMm + GAP),
    );
    page.heightMm = Math.max(
      page.heightMm,
      topMm + geometry.heightMm + (page.marginBottomMm ?? 2),
    );
    setCanvasGeometry(component, { ...geometry, leftMm: limit.left, topMm });
    page.components.push(component);
    return { pageIndex, newPage: false };
  }
  const next: TemplatePage = { ...page, components: [] };
  if (next.meta) {
    next.meta = { ...next.meta };
    delete next.meta.title;
  }
  setCanvasGeometry(
    component,
    constrainGeometry(
      { ...geometry, leftMm: limit.left, topMm: limit.top },
      next,
      component.kind === "list",
    ),
  );
  next.components.push(component);
  document.template.pages.push(next);
  return { pageIndex: document.template.pages.length - 1, newPage: true };
}
