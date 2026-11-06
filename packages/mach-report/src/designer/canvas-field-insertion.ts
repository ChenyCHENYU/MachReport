import { parseReportTemplate, type DatasetContract, type ReportTemplateDocument, type TemplateComponent } from "@agile-team/mach-report";
import { appendCanvasColumns, createCanvasComponent, type CanvasSelection } from "./canvas-commands";
import { canvasComponentFitsPage, placeCanvasComponent } from "./canvas-placement";
import { insertionColumn } from "./insertion-binding";

export function createBoundCanvasField(field: DatasetContract["fields"][number]): TemplateComponent {
  const component = createCanvasComponent("text");
  if (component.kind === "list") throw new TypeError("A bound field requires a text component");
  component.widthMm = 42; component.heightMm = 5; component.text = "";
  component.style = { fontSize: 8, lineHeight: 1.1, verticalAlign: "middle" };
  component.binding = { field: field.field, prefix: `${field.label || field.field}  `, ...(field.format ? { format: field.format } : {}) };
  return component;
}

/** Build a detached proposal. The caller confirms its size/page impact before one transaction. */
export function prepareCanvasFields(source: ReportTemplateDocument, pageIndex: number, fields: DatasetContract["fields"], listLocation: CanvasSelection | undefined, tooLarge: string) {
  const document = parseReportTemplate(source), selections: CanvasSelection[] = [];
  let widthBefore = 0, widthAfter = 0, count = fields.length;
  if (document.template.repeat) {
    for (const field of fields) {
      const component = createBoundCanvasField(field);
      if (!canvasComponentFitsPage(document.template.pages[pageIndex]!, component)) throw new Error(tooLarge);
      pageIndex = placeCanvasComponent(document, pageIndex, component).pageIndex;
      selections.push({ pageIndex, componentIndex: document.template.pages[pageIndex]!.components.length - 1 });
    }
  } else {
    if (!listLocation) return;
    const page = document.template.pages[listLocation.pageIndex]!, list = page.components[listLocation.componentIndex];
    if (list?.kind !== "list" || page.flow) return;
    const added = fields.filter(field => !list.columns.some(column => column.field === field.field));
    if (!added.length) return;
    count = added.length;
    widthBefore = list.widthMm;
    appendCanvasColumns(list, added.map(field => insertionColumn(field, 28)), page.layout === "wide");
    widthAfter = list.widthMm;
    if (page.layout === "wide") page.widthMm = Math.max(page.widthMm, list.leftMm + list.widthMm + (page.marginRightMm ?? 0));
    pageIndex = listLocation.pageIndex;
    selections.push(listLocation);
  }
  return { document, selections, pageIndex, widthBefore, widthAfter, count };
}
