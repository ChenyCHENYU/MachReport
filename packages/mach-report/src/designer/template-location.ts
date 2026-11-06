import type { ListComponent, ReportTemplateDocument, TemplateComponent } from "@agile-team/mach-report";
import type { TemplateInspectorSection } from "./useTemplateInspector";

export interface DesignerLocation {
  path?: string;
  pageIndex?: number;
  componentIndex?: number;
  field?: string;
}
export interface DesignerRuleTarget {
  tab: "computations" | "groups" | "conditions" | "detail" | "matrix" | "tree";
  field?: string;
  index?: number;
  effect?: "style" | "cell" | "rowVisibility";
}
export interface DesignerTarget {
  section: TemplateInspectorSection;
  tool?: "params" | "rules";
  pageIndex?: number;
  componentIndex?: number;
  field?: string;
  columnIndex?: number;
  paramField?: string;
  rule?: DesignerRuleTarget;
  control?: string;
}
export type DesignerLocationResult = { target: DesignerTarget; reason?: never } | { target?: never; reason: "removed" | "external" | "unavailable" };

/** JSON string identities and numeric offsets are parsed as data, never executable paths. */
function member(path: string, name: string): string | number | undefined {
  const match = new RegExp(`\\.${name}\\[(\\d+|"(?:[^"\\\\]|\\\\.)*")\\]`).exec(path);
  if (!match) return;
  try { return JSON.parse(match[1]!) as string | number; } catch { return; }
}
function namedIndex(items: readonly { field: string }[], identity: string | number | undefined): number {
  return typeof identity === "number" ? identity : items.findIndex(item => item.field === identity);
}
function ruleTarget(list: ListComponent, path: string, field?: string): DesignerRuleTarget | undefined {
  const computed = member(path, "computed");
  if (computed !== undefined) {
    const entry = list.computed?.[namedIndex(list.computed ?? [], computed)];
    return entry ? { tab: "computations", field: entry.field } : undefined;
  }
  const group = member(path, "groups");
  if (group !== undefined) return list.groups?.[Number(group)] ? { tab: "groups", index: Number(group) } : undefined;
  if (/\.(?:groupBy|grandTotal|aggregates)(?:\.|\[|$)/.test(path)) return { tab: "groups" };
  if (/\.rowVisibleWhen(?:\.|$)/.test(path)) return { tab: "conditions", effect: "rowVisibility" };
  if (/\.visibleWhen(?:\.|$)/.test(path)) return { tab: "conditions", field, effect: "cell" };
  const condition = member(path, "rules");
  if (condition !== undefined) return { tab: "conditions", field, index: Number(condition), effect: "style" };
  const layout = /\.(detail|matrix|tree)(?:\.|\[|$)/.exec(path)?.[1] as "detail" | "matrix" | "tree" | undefined;
  return layout ? { tab: layout } : undefined;
}
function listTarget(list: ListComponent, path: string, location: DesignerLocation): DesignerLocationResult {
  const column = member(path, "columns");
  const index = namedIndex(list.columns, column ?? location.field);
  const field = list.columns[index]?.field;
  if (column !== undefined && !list.columns[index])
    return { reason: "removed" };
  if (/\.grandTotal(?:\.|\[|$)/.test(path)) return { target: { section: "fields", control: "list-totals" } };
  const rule = ruleTarget(list, path, field);
  if (rule) return { target: { section: "tools", tool: "rules", field, rule } };
  if (/\.computed\[/.test(path)) return { reason: "removed" };
  if (list.columns[index]) {
    const property = /\.columns\[(?:\d+|"(?:[^"\\]|\\.)*")\]\.([\w]+)/.exec(path)?.[1];
    return { target: { section: "fields", field, columnIndex: index, control: `column-${property ?? "field"}` } };
  }
  return { target: { section: "component", control: "component-dataset" } };
}
function componentTarget(component: TemplateComponent, path: string, location: DesignerLocation): DesignerLocationResult {
  if (component.kind === "list") return listTarget(component, path, location);
  const property = /\.components\[\d+\]\.([\w]+)/.exec(path)?.[1];
  if (property === "binding") return { target: { section: "component", control: "binding-field" } };
  if (property === "chartBinding") return { target: { section: "component", control: `chart-${/\.chartBinding\.([\w]+)/.exec(path)?.[1] ?? "dataset"}` } };
  if (property === "code") return { target: { section: "component", control: "code-value" } };
  if (property === "style") return { target: { section: "component", control: `component-style-${/\.style\.([\w]+)/.exec(path)?.[1] ?? "fontSize"}` } };
  return { target: { section: "component", control: `component-${property ?? "text"}` } };
}
function parameterTarget(document: ReportTemplateDocument, path: string, identity: string | number): DesignerLocationResult {
  const entry = document.template.params?.[namedIndex(document.template.params ?? [], identity)];
  if (!entry) return { reason: "removed" };
  const property = /\.params\[(?:\d+|"(?:[^"\\]|\\.)*")\]\.([\w]+)/.exec(path)?.[1] ?? "field";
  return { target: { section: "tools", tool: "params", paramField: entry.field, control: property } };
}
function pageTarget(document: ReportTemplateDocument, location: DesignerLocation, path: string, pageIndex: number): DesignerLocationResult {
  const page = document.template.pages[pageIndex];
  if (!page) return { reason: "removed" };
  const offset = member(path, "components");
  const componentIndex = location.componentIndex ?? (typeof offset === "number" ? offset : undefined);
  if (componentIndex === undefined) return { target: { section: "template", pageIndex, control: `page-${path.split(".").at(-1) ?? "widthMm"}` } };
  const component = page.components[componentIndex];
  if (!component) return { reason: "removed" };
  const result = componentTarget(component, path, location);
  return result.target ? { target: { ...result.target, pageIndex, componentIndex } } : result;
}

/** A supported destination must still exist in the current draft, including semantic column IDs. */
function resolveLocation(document: ReportTemplateDocument, location: DesignerLocation, removed: boolean): DesignerLocationResult {
  if (removed) return { reason: "removed" };
  const path = location.path ?? "";
  if (/^\$\.(?:fixtures|datasets|dataSchemas)(?:\.|\[|$)/.test(path)) return { reason: "external" };
  if (path === "$.template.params" && document.template.params?.length) return parameterTarget(document, "$.template.params[0]", 0);
  const param = member(path, "params");
  if (param !== undefined) return parameterTarget(document, path, param);
  const offset = member(path, "pages");
  const pageIndex = location.pageIndex ?? (typeof offset === "number" ? offset : undefined);
  if (pageIndex !== undefined) return pageTarget(document, location, path, pageIndex);
  if (/^\$\.(?:name|description)$/.test(path)) return { target: { section: "template", control: `document-${path.slice(2)}` } };
  if (/^\$\.template\.repeat(?:\.|$)/.test(path)) return { target: { section: "template", control: "template-repeat" } };
  return { reason: "unavailable" };
}

export function resolveDesignerLocation(document: ReportTemplateDocument, location: DesignerLocation, removed = false, capabilities?: Partial<Record<"params" | "rules", boolean>>): DesignerLocationResult {
  const result = resolveLocation(document, location, removed);
  const tool = result.target?.tool;
  return tool && capabilities?.[tool] === false ? { reason: "unavailable" } : result;
}
