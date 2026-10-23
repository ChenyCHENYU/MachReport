import type { ReportTemplateDocument, TemplatePage } from "@agile-team/mach-report";
import { componentHeight } from "./canvas-commands";

export const PAGE_PRESETS = [
  { id: "label-80-55", widthMm: 80, heightMm: 55 },
  { id: "label-80-50", widthMm: 80, heightMm: 50 },
  { id: "label-100-60", widthMm: 100, heightMm: 60 },
  { id: "a4", widthMm: 210, heightMm: 297 },
  { id: "a3", widthMm: 297, heightMm: 420 },
] as const;
export type PagePatch = Partial<Pick<TemplatePage, "widthMm" | "heightMm" | "layout" | "marginTopMm" | "marginRightMm" | "marginBottomMm" | "marginLeftMm" | "meta">>;
export type PageCommand = { type: "patch"; patch: PagePatch } | { type: "add" | "duplicate" | "remove" };

export function pageName(page: TemplatePage, index: number, fallback: string): string {
  return typeof page.meta?.title === "string" && page.meta.title.trim() ? page.meta.title : `${fallback} ${index + 1}`;
}

/** A smaller sheet never silently scales or moves the user's design. */
export function pageOverflow(page: TemplatePage): number[] {
  return page.components.flatMap((component, index) => {
    const height = component.kind === "list" ? component.rowHeightMm ?? componentHeight(component) : component.heightMm;
    return component.leftMm < 0 || component.topMm < 0 || component.leftMm + component.widthMm > page.widthMm + .001 || component.topMm + height > page.heightMm + .001 ? [index] : [];
  });
}

function duplicatePage(page: TemplatePage, pages: TemplatePage[]): TemplatePage {
  const copy = JSON.parse(JSON.stringify(page)) as TemplatePage;
  const used = new Set(pages.flatMap(item => item.components.map(component => component.kind === "list" ? component.id : component.nid)).filter(Boolean));
  const replacements = new Map<string, string>();
  let sequence = 0;
  for (const component of copy.components) {
    const old = component.kind === "list" ? component.id : component.nid;
    if (!old) continue;
    let id: string;
    do { id = `page-copy-${++sequence}`; } while (used.has(id));
    used.add(id); replacements.set(old, id);
    if (component.kind === "list") component.id = id;
    else { component.nid = id; delete component.rkey; }
  }
  copy.flow?.bands.forEach(band => { band.componentIds = band.componentIds.map(id => replacements.get(id) ?? id); });
  return copy;
}

/** Called inside the editor's validated transaction; returns the next selected page. */
export function applyPageCommand(document: ReportTemplateDocument, index: number, command: PageCommand): number {
  const pages = document.template.pages, page = pages[index];
  if (!page) return 0;
  if (command.type === "patch") { Object.assign(page, command.patch); return index; }
  if (command.type === "remove") {
    if (pages.length <= 1) return index;
    pages.splice(index, 1); return Math.min(index, pages.length - 1);
  }
  const next = command.type === "duplicate" ? duplicatePage(page, pages) : JSON.parse(JSON.stringify(page)) as TemplatePage;
  if (command.type === "add") { next.components = []; delete next.flow; delete next.meta; }
  pages.splice(index + 1, 0, next); return index + 1;
}
