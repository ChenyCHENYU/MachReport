import type { ReportTemplateDocument } from "./template-registry";
import { parseReportTemplate } from "./template-registry";
import type { TemplateComponent, TemplatePage } from "../layout/paginate";
import type { ComponentStyle } from "../schema/render-plan";
import { collectTemplateDatasetBindings } from "./template-bindings";
import { mergeComponentStyles } from "../render/style";

/** Plain JSON, versioned by the host; inserting never links mutable library objects. */
export interface ReportTemplateFragment {
  id: string;
  name: string;
  revision: string;
  components: TemplateComponent[];
  repeatDataset?: string;
}
export interface ReportDocumentStyle {
  id: string;
  name: string;
  style: ComponentStyle;
  target?: "content" | "header";
}
export interface TemplateFragmentBindings {
  datasets?: Record<string, string>;
  fields?: Record<string, Record<string, string>>;
}
export interface TemplateFragmentInsertOptions {
  pageIndex: number;
  leftMm?: number;
  topMm?: number;
  bindings?: TemplateFragmentBindings;
  replaceInstance?: string;
}
export interface TemplateFragmentResult {
  document: ReportTemplateDocument;
  componentIndices: number[];
  instance: string;
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function fragmentTemplate(
  fragment: Pick<ReportTemplateFragment, "components" | "repeatDataset">,
) {
  return {
    ...(fragment.repeatDataset
      ? { repeat: { dataset: fragment.repeatDataset } }
      : {}),
    pages: [{ widthMm: 4999, heightMm: 4999, components: fragment.components }],
  };
}
function validateFragment(fragment: ReportTemplateFragment): void {
  if (!fragment.id.trim() || !fragment.name.trim() || !fragment.revision.trim())
    throw new Error("Fragment identity, name and revision are required");
  if (!fragment.components.length || fragment.components.length > 200)
    throw new RangeError("A fragment must contain 1–200 components");
  // The canonical JSON validator rejects accessors, cycles and invalid geometry before cloning.
  parseReportTemplate({
    schemaVersion: "1.0",
    id: fragment.id,
    name: fragment.name,
    template: fragmentTemplate(fragment),
  });
}
export function captureTemplateFragment(
  document: ReportTemplateDocument,
  pageIndex: number,
  indices: readonly number[],
  identity: Pick<ReportTemplateFragment, "id" | "name" | "revision">,
): ReportTemplateFragment {
  const source = parseReportTemplate(document).template.pages[pageIndex];
  if (
    !source ||
    !indices.length ||
    indices.some(
      (index) => !Number.isSafeInteger(index) || !source.components[index],
    )
  )
    throw new Error("Select existing components to capture a fragment");
  const components = [...new Set(indices)].map(
    (index) => source.components[index]!,
  );
  const left = Math.min(...components.map((item) => item.leftMm)),
    top = Math.min(...components.map((item) => item.topMm));
  const fragment = {
    ...identity,
    ...(document.template.repeat
      ? { repeatDataset: document.template.repeat.dataset }
      : {}),
    components: clone(components).map((component) => ({
      ...component,
      leftMm: component.leftMm - left,
      topMm: component.topMm - top,
    })),
  };
  validateFragment(fragment);
  return fragment;
}
export function inspectTemplateFragmentBindings(
  fragment: ReportTemplateFragment,
) {
  validateFragment(fragment);
  const datasets = new Map<string, Set<string>>();
  for (const binding of collectTemplateDatasetBindings(
    fragmentTemplate(fragment),
  )) {
    const fields = datasets.get(binding.dataset) ?? new Set<string>();
    for (const reference of binding.fields)
      if (
        !binding.generated.has(reference.field) &&
        !binding.summaries.has(reference.field)
      )
        fields.add(reference.field);
    datasets.set(binding.dataset, fields);
  }
  return [...datasets].map(([dataset, fields]) => ({
    dataset,
    fields: [...fields],
  }));
}
function assignAtPath(value: unknown, path: string, next: string): void {
  const keys = path
    .replace(/^\$\.template\./, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".");
  let current = value as Record<string, unknown>;
  for (const key of keys.slice(0, -1))
    current = current[key] as Record<string, unknown>;
  current[keys[keys.length - 1]!] = next;
}
function rebind(
  fragment: ReportTemplateFragment,
  components: TemplateComponent[],
  bindings: TemplateFragmentBindings = {},
): void {
  const template = fragmentTemplate({ ...fragment, components });
  for (const binding of collectTemplateDatasetBindings(template)) {
    for (const reference of binding.fields) {
      const next = bindings.fields?.[binding.dataset]?.[reference.field];
      if (next !== undefined) assignAtPath(template, reference.path, next);
    }
    const dataset = bindings.datasets?.[binding.dataset];
    if (dataset !== undefined)
      assignAtPath(template, `${binding.path}.dataset`, dataset);
  }
}
function cleanIdentities(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(cleanIdentities);
    return;
  }
  const object = value as Record<string, unknown>;
  for (const key of ["nid", "rkey", "table", "source"]) delete object[key];
  if (object.kind === "list") delete object.id;
  if (object.meta && typeof object.meta === "object")
    for (const key of ["fragment", "labelSource", "record"])
      delete (object.meta as Record<string, unknown>)[key];
  Object.values(object).forEach(cleanIdentities);
}
function nextInstance(document: ReportTemplateDocument): string {
  const used = new Set(
    document.template.pages.flatMap((page) =>
      page.components.map(
        (component) =>
          (component.meta?.fragment as { instance?: string } | undefined)
            ?.instance,
      ),
    ),
  );
  let sequence = 1;
  while (used.has(`fragment-${sequence}`)) sequence++;
  return `fragment-${sequence}`;
}
function replacementTarget(
  page: TemplatePage,
  fragment: ReportTemplateFragment,
  instance?: string,
) {
  const replacing = instance
    ? page.components.flatMap((component, index) =>
        (component.meta?.fragment as { instance?: string } | undefined)
          ?.instance === instance
          ? [index]
          : [],
      )
    : [];
  if (instance && !replacing.length)
    throw new Error("Fragment instance no longer exists");
  const old = replacing.map((index) => page.components[index]!);
  if (
    old.some(
      (component) =>
        (component.meta?.fragment as { id?: string } | undefined)?.id !==
        fragment.id,
    )
  )
    throw new Error("An upgrade must use the same fragment identity");
  return {
    replacing,
    left: old.length
      ? Math.min(...old.map((item) => item.leftMm))
      : (page.marginLeftMm ?? 0),
    top: old.length
      ? Math.min(...old.map((item) => item.topMm))
      : (page.marginTopMm ?? 0),
  };
}
function assertFragmentFits(
  page: TemplatePage,
  components: TemplateComponent[],
): void {
  if (
    components.some(
      (component) =>
        component.leftMm < 0 ||
        component.topMm < 0 ||
        component.leftMm + component.widthMm > page.widthMm + 0.001 ||
        component.topMm +
          (component.kind === "list"
            ? (component.rowHeightMm ?? 7)
            : component.heightMm) >
          page.heightMm + 0.001,
    )
  )
    throw new Error(
      "Fragment exceeds the target page; choose a larger page or adjust its placement",
    );
}
/** Explicit replacement is atomic and preserves surrounding components and the document CAS revision. */
export function insertTemplateFragment(
  input: ReportTemplateDocument,
  fragment: ReportTemplateFragment,
  options: TemplateFragmentInsertOptions,
): TemplateFragmentResult {
  validateFragment(fragment);
  const document = parseReportTemplate(input),
    page = document.template.pages[options.pageIndex];
  if (!page || page.flow)
    throw new Error("Choose a fixed page before inserting a fragment");
  const target = replacementTarget(page, fragment, options.replaceInstance),
    replacing = target.replacing;
  const left = options.leftMm ?? target.left,
    top = options.topMm ?? target.top;
  const components = clone(fragment.components),
    instance = options.replaceInstance ?? nextInstance(document);
  if (
    fragment.repeatDataset &&
    document.template.repeat?.dataset !==
      (options.bindings?.datasets?.[fragment.repeatDataset] ??
        fragment.repeatDataset)
  )
    throw new Error("Bind this label fragment to the current record dataset");
  rebind(fragment, components, options.bindings);
  components.forEach(cleanIdentities);
  components.forEach((component, index) => {
    component.leftMm += left;
    component.topMm += top;
    component.meta = {
      ...component.meta,
      fragment: {
        id: fragment.id,
        revision: fragment.revision,
        instance,
        slot: index,
      },
    };
  });
  assertFragmentFits(page, components);
  const insertion = replacing[0] ?? page.components.length;
  page.components = page.components.filter(
    (_, index) => !replacing.includes(index),
  );
  page.components.splice(insertion, 0, ...components);
  return {
    document: parseReportTemplate(document),
    componentIndices: components.map((_, index) => insertion + index),
    instance,
  };
}
/** Styles affect report content only, never the surrounding designer/preview theme. */
export function applyReportDocumentStyle(
  input: ReportTemplateDocument,
  pageIndex: number,
  indices: readonly number[],
  role: ReportDocumentStyle,
): ReportTemplateDocument {
  const document = parseReportTemplate(input),
    page = document.template.pages[pageIndex];
  if (!page) throw new Error("Page no longer exists");
  for (const index of indices) {
    const component = page.components[index];
    if (!component) throw new Error("Component no longer exists");
    if (component.kind === "list") {
      if (role.target === "header") applyHeaderStyle(component, role.style);
      else
        component.columns.forEach((column) => {
          column.style = mergeComponentStyles(column.style, clone(role.style));
          if (role.style.align) column.align = role.style.align;
        });
    } else
      component.style = mergeComponentStyles(
        component.style,
        clone(role.style),
      );
  }
  return parseReportTemplate(document);
}
function applyHeaderStyle(
  component: Extract<TemplateComponent, { kind: "list" }>,
  style: ComponentStyle,
): void {
  component.headerStyle = mergeComponentStyles(
    component.headerStyle,
    clone(style),
  );
  component.columns.forEach((column) => {
    column.headerStyle = mergeComponentStyles(column.headerStyle, clone(style));
    if (style.align) column.headerAlign = style.align;
  });
  if (component.headerGrid)
    for (const row of component.headerGrid.cells)
      for (const cell of row)
        if (cell) cell.style = mergeComponentStyles(cell.style, clone(style));
}
