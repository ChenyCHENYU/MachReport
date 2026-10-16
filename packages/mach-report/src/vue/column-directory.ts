import { resolveGridLayout } from "../render/grid-geometry";
import type { PlanComponent, RenderPlan } from "../schema/render-plan";
import type { ReportSection } from "./tools";

export interface ReportColumnTarget { field: string; datasetId?: string; tableId?: string }
export interface ReportColumnEntry extends ReportColumnTarget {
  key: string;
  label: string;
  group: string;
  pageIndex: number;
}

function columnLabels(component: PlanComponent): string[] {
  const keys = component.table?.columnKeys ?? [];
  const labels = keys.map(() => [] as string[]);
  if (!component.grid) return keys;
  for (const { ci, cell } of resolveGridLayout(component.grid, component.widthMm, component.heightMm).cells) {
    const text = (cell.text ?? cell.rawText ?? "").trim();
    if (!text) continue;
    for (let index = ci; index < Math.min(keys.length, ci + (cell.colSpan ?? 1)); index++) {
      if (!labels[index]!.includes(text)) labels[index]!.push(text);
    }
  }
  return keys.map((key, index) => labels[index]!.join(" / ") || key);
}

/** Read each logical header once; pagination does not duplicate the column catalogue. */
export function createColumnDirectory(plan: RenderPlan | null | undefined, sections: readonly ReportSection[] = []): ReportColumnEntry[] {
  const seen = new Set<string>();
  const result: ReportColumnEntry[] = [];
  for (const [pageIndex, page] of (plan?.pages ?? []).entries()) {
    for (const component of page.components) {
      const table = component.table;
      if (!table || table.role !== "header" || seen.has(table.id)) continue;
      seen.add(table.id);
      const labels = columnLabels(component);
      const preceding = sections.filter((item) => item.pageIndex <= pageIndex);
      const section = preceding[preceding.length - 1]?.label;
      const datasetId = table.source?.datasetId;
      const group = [...new Set([section, table.title, datasetId].filter(Boolean))].join(" · ") || table.id;
      table.columnKeys.forEach((field, index) => {
        if (!field) return;
        result.push({ key: JSON.stringify([table.id, index]), field, label: labels[index]!, group, pageIndex, tableId: table.id, ...(datasetId ? { datasetId } : {}) });
      });
    }
  }
  return result;
}

export function searchColumnDirectory(entries: readonly ReportColumnEntry[], query: string): ReportColumnEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const text = `${entry.label} ${entry.field} ${entry.group}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
