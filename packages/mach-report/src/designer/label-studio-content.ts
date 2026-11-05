import { parseReportTemplate, type DatasetContract, type ReportTemplateDocument, type TemplateComponent } from "@agile-team/mach-report";
import { createLabelStudioDocument } from "./label-studio-template";
import type { LabelStudioLayout } from "./label-studio-presets";

type LabelPage = ReportTemplateDocument["template"]["pages"][number];
const role = (component: TemplateComponent) => component.meta?.labelStudioRole;
const managed = (component: TemplateComponent) => typeof role(component) === "string";
function withoutRole(component: TemplateComponent): TemplateComponent {
  const value = { ...component, ...(component.meta ? { meta: { ...component.meta } } : {}) };
  if (value.meta) {
    delete value.meta.labelStudioRole;
    delete value.meta.labelStudioField;
    if (!Object.keys(value.meta).length) delete value.meta;
  }
  return value;
}
/** Old documents have no role markers. Only unchanged canonical components can be safely adopted. */
function adoptRoles(page: LabelPage, canonical: LabelPage): void {
  for (const expected of canonical.components.filter(managed)) {
    if (page.components.some(component => role(component) === role(expected) && component.meta?.labelStudioField === expected.meta?.labelStudioField)) continue;
    const match = page.components.find(component => !managed(component) && JSON.stringify(withoutRole(component)) === JSON.stringify(withoutRole(expected)));
    if (match) match.meta = { ...match.meta, ...expected.meta };
  }
}
function intersects(left: TemplateComponent, right: TemplateComponent): boolean {
  const leftHeight = left.kind === "list" ? Number.POSITIVE_INFINITY : left.heightMm;
  const rightHeight = right.kind === "list" ? Number.POSITIVE_INFINITY : right.heightMm;
  return left.leftMm < right.leftMm + right.widthMm && left.leftMm + left.widthMm > right.leftMm
    && left.topMm < right.topMm + rightHeight && left.topMm + leftHeight > right.topMm;
}
// The canonical document is already an independent snapshot. Transfer its bindings without another clone.
function updateContent(current: TemplateComponent, expected: TemplateComponent): TemplateComponent {
  const next = { ...current, meta: { ...current.meta, ...expected.meta } };
  if (next.kind === "text" && expected.kind === "text") {
    next.text = expected.text;
    if (expected.binding) next.binding = expected.binding;
    else delete next.binding;
  }
  return next;
}
function patchPage(page: LabelPage, previous: LabelPage, desired: LabelPage, changes: Set<string>): boolean {
  const fieldsChanged = changes.has("field-value");
  adoptRoles(page, previous);
  const before = new Set(page.components.filter(component => role(component) === "field-label" || role(component) === "field-value"));
  const slots = [...before];
  const replacements = new Map<TemplateComponent, TemplateComponent>();
  const additions: TemplateComponent[] = [];
  for (const expected of desired.components.filter(managed)) {
    const kind = role(expected);
    if (!changes.has(String(kind))) continue;
    const current = kind === "field-label" || kind === "field-value" ? slots.find(component => role(component) === kind && !replacements.has(component)) : page.components.find(component => role(component) === kind);
    if (current) replacements.set(current, updateContent(current, expected));
    else additions.push(expected);
  }
  const components = page.components.filter(component => (!fieldsChanged || !before.has(component) || replacements.has(component)) && (!changes.has("brand-tagline") || role(component) !== "brand-tagline" || desired.components.some(item => role(item) === "brand-tagline")))
    .map(component => replacements.get(component) ?? component);
  for (const component of additions) {
    if (components.some(existing => intersects(existing, component))) return false;
    components.push(component);
  }
  page.components = components;
  page.meta = { ...page.meta, labelStudio: desired.meta?.labelStudio };
  return true;
}
/** Brand and managed field rows change in place. Extra pages, geometry, styling and custom components remain authoritative. */
export function patchLabelStudioContent(document: ReportTemplateDocument, schema: DatasetContract, title: string, identity: string | undefined, previous: LabelStudioLayout, desired: LabelStudioLayout): ReportTemplateDocument | undefined {
  const before = createLabelStudioDocument(schema, title, identity, previous);
  const after = createLabelStudioDocument(schema, title, identity, desired);
  const next = parseReportTemplate(document);
  const changes = new Set<string>();
  if (JSON.stringify(previous.fields) !== JSON.stringify(desired.fields)) { changes.add("field-label"); changes.add("field-value"); }
  if ((previous.brand?.name ?? "").trim() !== (desired.brand?.name ?? "").trim()) changes.add("brand-name");
  if ((previous.brand?.tagline ?? "").trim() !== (desired.brand?.tagline ?? "").trim()) changes.add("brand-tagline");
  for (const [index, page] of next.template.pages.entries()) {
    const baseline = before.template.pages[index], target = after.template.pages[index];
    if (baseline && target && !patchPage(page, baseline, target, changes)) return;
  }
  return next;
}
export function isCustomLabelStudioLayout(document: ReportTemplateDocument, canonical: ReportTemplateDocument): boolean {
  const pages = document.template.pages, expected = canonical.template.pages;
  if (pages.length !== expected.length || pages.some((page, index) => page.components.length !== expected[index]!.components.length)) return true;
  return pages.some((page, index) => {
    const target = expected[index]!;
    const geometry = { ...page, meta: undefined, components: undefined };
    const targetGeometry = { ...target, meta: undefined, components: undefined };
    return JSON.stringify(geometry) !== JSON.stringify(targetGeometry)
      || page.components.some((component, position) => JSON.stringify(withoutRole(component)) !== JSON.stringify(withoutRole(target.components[position]!)));
  });
}

export function rebuildLabelStudioDocument(document: ReportTemplateDocument, schema: DatasetContract, title: string, identity: string | undefined, layout: LabelStudioLayout): ReportTemplateDocument {
  const next = { ...document, template: createLabelStudioDocument(schema, title, identity, layout, document.template.dataContract).template };
  const repeat = document.template.repeat;
  if (repeat?.copies !== undefined && next.template.repeat) next.template.repeat.copies = repeat.copies;
  return next;
}
