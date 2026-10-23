import type { ReportTemplate, TemplateComponent } from "../layout/paginate";
import { collectTemplateDatasetBindings } from "./template-bindings";

export interface TemplateOutlineLocation {
  path: string;
  pageIndex?: number;
  componentIndex?: number;
  field?: string;
}
export interface TemplateOutlineEntry extends TemplateOutlineLocation {
  kind: "page" | "component" | "field" | "calculation" | "binding";
  title: string;
  dataset?: string;
  depth: number;
}
export interface TemplateFieldUsage extends TemplateOutlineLocation {
  dataset: string;
  field: string;
  kind: "display" | "calculation" | "binding";
}
export function templatePathLocation(
  path: string,
): Pick<TemplateOutlineLocation, "pageIndex" | "componentIndex"> {
  const match = /\.pages\[(\d+)\](?:\.components\[(\d+)\])?/.exec(path);
  return match
    ? {
        pageIndex: Number(match[1]),
        ...(match[2] === undefined ? {} : { componentIndex: Number(match[2]) }),
      }
    : {};
}
/** Includes rule, aggregate, relation and formula references; never evaluates expressions. */
export function inspectTemplateFieldUsage(
  template: ReportTemplate,
  dataset: string,
  field: string,
): TemplateFieldUsage[] {
  return collectTemplateDatasetBindings(template)
    .filter((binding) => binding.dataset === dataset)
    .flatMap((binding) =>
      binding.fields
        .filter((item) => item.field === field)
        .map((item) => ({
          ...item,
          ...templatePathLocation(item.path),
          dataset,
          kind: /\.computed\[/.test(item.path)
            ? ("calculation" as const)
            : /\.columns\[\d+\]\.field$/.test(item.path)
              ? ("display" as const)
              : ("binding" as const),
        })),
    );
}
function componentTitle(component: TemplateComponent, index: number): string {
  const value =
    component.kind === "list"
      ? component.title || component.dataset
      : component.binding?.field || component.text || component.nid;
  return `${component.kind} · ${(value || String(index + 1)).replace(/\s+/g, " ").slice(0, 80)}`;
}
/** A flat, indexed outline allows the UI to render a bounded search window. */
export function collectTemplateOutline(
  template: ReportTemplate,
): TemplateOutlineEntry[] {
  const bindings = collectTemplateDatasetBindings(template);
  const references = new Map<
    string,
    Array<{ dataset: string; field: string; path: string }>
  >();
  for (const binding of bindings)
    for (const reference of binding.fields) {
      const componentPath =
        /^\$\.template\.pages\[\d+\]\.components\[\d+\]/.exec(
          reference.path,
        )?.[0];
      if (!componentPath) continue;
      const entries = references.get(componentPath) ?? [];
      entries.push({ ...reference, dataset: binding.dataset });
      references.set(componentPath, entries);
    }
  const result: TemplateOutlineEntry[] = [];
  template.pages.forEach((page, pageIndex) => {
    const pagePath = `$.template.pages[${pageIndex}]`;
    result.push({
      path: pagePath,
      pageIndex,
      kind: "page",
      depth: 0,
      title:
        typeof page.meta?.title === "string"
          ? page.meta.title
          : `${pageIndex + 1} · ${page.widthMm} × ${page.heightMm} mm`,
    });
    page.components.forEach((component, componentIndex) => {
      const path = `${pagePath}.components[${componentIndex}]`,
        location = { pageIndex, componentIndex };
      result.push({
        path,
        ...location,
        depth: 1,
        kind: "component",
        title: componentTitle(component, componentIndex),
      });
      if (component.kind === "list") {
        component.columns.forEach((column, index) =>
          result.push({
            path: `${path}.columns[${index}].field`,
            ...location,
            depth: 2,
            kind: "field",
            title: `${column.header} · ${column.field}`,
            field: column.field,
            dataset: component.dataset,
          }),
        );
        component.computed?.forEach((field, index) =>
          result.push({
            path: `${path}.computed[${index}]`,
            ...location,
            depth: 2,
            kind: "calculation",
            title: field.field,
            field: field.field,
            dataset: component.dataset,
          }),
        );
      }
      const seen = new Set<string>();
      for (const reference of references.get(path) ?? []) {
        if (
          /\.columns\[\d+\]\.field$/.test(reference.path) ||
          seen.has(reference.path)
        )
          continue;
        seen.add(reference.path);
        result.push({
          ...reference,
          ...location,
          depth: 2,
          kind: "binding",
          title: reference.field,
        });
      }
    });
  });
  return result;
}
