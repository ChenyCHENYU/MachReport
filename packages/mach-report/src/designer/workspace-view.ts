import { inject, provide, ref, shallowRef, type InjectionKey } from "vue";
import type { ListComponent, ReportTemplateDocument, TemplateComponent, TemplatePage } from "@agile-team/mach-report";
import type { TemplateInspectorSection } from "./useTemplateInspector";
import type { DesignerRuleTarget } from "./template-location";

export interface DesignerViewport { zoom: number; left: number; top: number }
export interface DesignerWorkspaceView {
  version: 1;
  templateId: string;
  documentKey: string;
  page: { index: number; key: string };
  componentKey?: string;
  field?: string;
  section: TemplateInspectorSection;
  tool: "excel" | "rules" | "review" | "params" | "outline" | "reuse";
  mode: "design" | "preview";
  viewport?: DesignerViewport;
  paramField?: string;
  rule?: DesignerRuleTarget;
}
interface DesignerToolCursor {
  paramField?: string;
  rule?: { key: string; target: DesignerRuleTarget };
}
const CURSOR_KEY: InjectionKey<ReturnType<typeof shallowRef<DesignerToolCursor>>> = Symbol("mach-report-designer-cursor");
export function provideDesignerCursor() {
  const cursor = shallowRef<DesignerToolCursor>({});
  provide(CURSOR_KEY, cursor);
  return cursor;
}
export const useDesignerCursor = () => inject(CURSOR_KEY, undefined);
interface ViewportPort {
  read(): DesignerViewport;
  restore(view: DesignerViewport): void;
  reset(): void;
}
interface ViewportBridge {
  revision: ReturnType<typeof ref<number>>;
  register(port: ViewportPort): () => void;
  changed(): void;
  read(): DesignerViewport | undefined;
  restore(view: DesignerViewport | undefined): void;
}
const VIEWPORT_KEY: InjectionKey<ViewportBridge> = Symbol("mach-report-designer-viewport");
export function provideDesignerViewport(): ViewportBridge {
  let current: ViewportPort | undefined, pending: DesignerViewport | undefined;
  const revision = ref(0);
  const bridge: ViewportBridge = {
    revision,
    register(port) {
      current = port;
      if (pending) { port.restore(pending); pending = undefined; }
      return () => { if (current === port) current = undefined; };
    },
    changed() { revision.value++; },
    read: () => current?.read() ?? pending,
    restore(view) {
      if (!view) { pending = undefined; current?.reset(); }
      else if (current) current.restore(view);
      else pending = view;
    },
  };
  provide(VIEWPORT_KEY, bridge);
  return bridge;
}
export const useDesignerViewport = () => inject(VIEWPORT_KEY, undefined);

/** Compact structural identities contain no report values, images or sample data. */
function digest(value: string): string {
  let first = 2166136261, second = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 33);
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
export function componentViewKey(component: TemplateComponent): string {
  const identity = component.kind === "list" ? component.id : component.nid;
  if (identity) return `id:${digest(`${component.kind}:${identity}`)}`;
  const content = component.kind === "list" ? component.dataset : component.binding?.field ?? component.text?.slice(0, 120) ?? "";
  return `shape:${digest(JSON.stringify([component.kind, content, component.leftMm, component.topMm, component.widthMm]))}`;
}
export function pageViewKey(page: TemplatePage): string {
  return digest(JSON.stringify([page.meta?.title, page.widthMm, page.heightMm, page.components.map(componentViewKey).sort()]));
}
export function documentViewKey(document: ReportTemplateDocument): string {
  const structure = document.template.pages.map(page => [
    pageViewKey(page),
    page.components.map(component => component.kind === "list" ? [
      component.columns.map(column => [column.field, column.rules, column.visibleWhen]),
      component.computed?.map(field => field.field),
      component.groups,
      component.rowVisibleWhen,
    ] : componentViewKey(component)),
  ]);
  return digest(JSON.stringify(structure));
}
export function resolveWorkspaceRule(list: ListComponent | undefined, rule: DesignerRuleTarget | undefined, changed: boolean): DesignerRuleTarget | undefined {
  if (!list || !rule) return;
  if (rule.tab === "computations") return !rule.field || list.computed?.some(item => item.field === rule.field) ? rule : undefined;
  if (rule.tab === "groups") return changed ? { tab: "groups" } : rule;
  if (rule.tab !== "conditions") return rule;
  if (rule.field && !list.columns.some(column => column.field === rule.field)) return;
  return changed ? { ...rule, index: -1 } : rule;
}
function validateViewport(viewport: DesignerViewport | undefined): void {
  if (!viewport) return;
  if (!Number.isFinite(viewport.zoom) || viewport.zoom < .05 || viewport.zoom > 2 || ![viewport.left, viewport.top].every(position => Number.isFinite(position) && position >= 0 && position <= 10_000_000)) throw new Error("Invalid workspace viewport");
}
function validateViewPage(value: DesignerWorkspaceView): void {
  if (!Number.isSafeInteger(value.page?.index) || value.page.index < 0 || value.page.index > 100000 || typeof value.page.key !== "string" || value.page.key.length > 32) throw new Error("Invalid workspace page position");
  for (const key of ["componentKey", "field", "paramField"] as const) if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > 1024)) throw new Error("Invalid workspace field position");
}
function validateRuleCursor(rule: DesignerRuleTarget | undefined): void {
  if (!rule) return;
  if (!["computations", "groups", "conditions", "detail", "matrix", "tree"].includes(rule.tab)) throw new Error("Invalid workspace rule panel");
  if (rule.field !== undefined && (typeof rule.field !== "string" || rule.field.length > 1024)) throw new Error("Invalid workspace rule field");
  if (rule.index !== undefined && (!Number.isSafeInteger(rule.index) || rule.index < -1 || rule.index > 100000)) throw new Error("Invalid workspace rule index");
  if (rule.effect !== undefined && !["style", "cell", "rowVisibility"].includes(rule.effect)) throw new Error("Invalid workspace rule effect");
}
export function parseWorkspaceView(raw: string, templateId: string): DesignerWorkspaceView {
  if (raw.length * 2 > 8192) throw new Error("Workspace position exceeds 8 KiB");
  const value = JSON.parse(raw) as DesignerWorkspaceView;
  if (value.version !== 1 || value.templateId !== templateId || typeof value.documentKey !== "string" || value.documentKey.length > 32) throw new Error("Invalid workspace position identity");
  validateViewPage(value);
  if (!["fields", "component", "template", "tools", "advanced"].includes(value.section) || !["excel", "rules", "review", "params", "outline", "reuse"].includes(value.tool) || !["design", "preview"].includes(value.mode)) throw new Error("Invalid workspace panel position");
  validateViewport(value.viewport);
  validateRuleCursor(value.rule);
  return {
    version: 1,
    templateId: value.templateId,
    documentKey: value.documentKey,
    page: { index: value.page.index, key: value.page.key },
    componentKey: value.componentKey,
    field: value.field,
    section: value.section,
    tool: value.tool,
    mode: value.mode,
    viewport: value.viewport ? { zoom: value.viewport.zoom, left: value.viewport.left, top: value.viewport.top } : undefined,
    paramField: value.paramField,
    rule: value.rule ? { tab: value.rule.tab, field: value.rule.field, index: value.rule.index, effect: value.rule.effect } : undefined,
  };
}
export function resolveWorkspaceView(document: ReportTemplateDocument, view: DesignerWorkspaceView): { pageIndex: number; componentIndex?: number; fieldIndex?: number; adjusted: boolean } {
  const pages = document.template.pages;
  const sameDocument = documentViewKey(document) === view.documentKey;
  const matches = pages.flatMap((page, index) => pageViewKey(page) === view.page.key ? [index] : []);
  let pageIndex = sameDocument && pages[view.page.index] ? view.page.index : matches.length === 1 ? matches[0]! : -1;
  const components = view.componentKey ? pages.flatMap((page, pageIndex) =>
    page.components.flatMap((component, componentIndex) =>
      componentViewKey(component) === view.componentKey ? [{ pageIndex, componentIndex }] : [])) : [];
  if (pageIndex < 0 && components.length === 1) pageIndex = components[0]!.pageIndex;
  const componentMatches = components.filter(item => item.pageIndex === pageIndex);
  const componentIndex = componentMatches.length === 1 ? componentMatches[0]!.componentIndex : undefined;
  const component = pages[pageIndex]?.components[componentIndex ?? -1];
  const fieldIndex = component?.kind === "list" && view.field ? component.columns.findIndex(column => column.field === view.field) : -1;
  return { pageIndex: Math.max(0, pageIndex), componentIndex, ...(fieldIndex >= 0 ? { fieldIndex } : {}), adjusted: !sameDocument || !!view.componentKey && componentIndex === undefined || !!view.field && fieldIndex < 0 };
}
