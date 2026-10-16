import type { RenderPlan, ReportCellSource } from "../schema/render-plan";
import type { ReportEditBatch, ReportEditResult } from "./batch";

/** Refresh concurrency metadata without changing values, layout, or the host's source objects. */
export function applyReportEditResult(plan: RenderPlan, batch: ReportEditBatch, result: void | ReportEditResult): RenderPlan {
  if (!result || (result.revision === undefined && result.sourceToken === undefined)) return plan;
  const datasets = new Set(batch.edits.flatMap((edit) => edit.source ? [edit.source.datasetId] : []));
  if (!datasets.size) return plan;
  function source<T extends Partial<ReportCellSource>>(current: T): T {
    if (!current.datasetId || !datasets.has(current.datasetId)) return current;
    if ((result!.revision === undefined || Object.is(result!.revision, current.revision)) && (result!.sourceToken === undefined || result!.sourceToken === current.sourceToken)) return current;
    return { ...current, ...(result!.revision !== undefined ? { revision: result!.revision } : {}), ...(result!.sourceToken !== undefined ? { sourceToken: result!.sourceToken } : {}) };
  }
  const pages = plan.pages.map((page) => {
    const components = page.components.map((component) => {
      const nextSource = component.table?.source ? source(component.table.source) : undefined;
      const table = component.table && nextSource !== component.table.source ? { ...component.table, source: nextSource } : component.table;
      const cells = component.grid?.cells.map((row) => {
        const next = row.map((cell) => {
          if (!cell?.source) return cell;
          const nextSource = source(cell.source);
          return nextSource === cell.source ? cell : { ...cell, source: nextSource };
        });
        return next.some((cell, index) => cell !== row[index]) ? next : row;
      });
      const grid = component.grid && cells?.some((row, index) => row !== component.grid!.cells[index]) ? { ...component.grid, cells: cells! } : component.grid;
      return table !== component.table || grid !== component.grid ? { ...component, table, grid } : component;
    });
    return components.some((component, index) => component !== page.components[index]) ? { ...page, components } : page;
  });
  return pages.some((page, index) => page !== plan.pages[index]) ? { ...plan, pages } : plan;
}
