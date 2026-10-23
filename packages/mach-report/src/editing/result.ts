import type { RenderPlan, ReportCellSource, PlanComponent } from "../schema/render-plan";
import type { ReportEditBatch, ReportEditResult } from "./batch";
import { sourceDatasetKey } from "./session-data";

/** Refresh concurrency metadata without changing values, layout, or the host's source objects. */
export function applyReportEditResult(plan: RenderPlan, batch: ReportEditBatch, result: void | ReportEditResult): RenderPlan {
  if (!result || (result.revision === undefined && result.sourceToken === undefined)) return plan;
  const datasets = new Set(batch.edits.flatMap((edit) => edit.source ? [sourceDatasetKey(edit.source)] : []));
  return applyReportSourceMetadata(plan, new Map([...datasets].map(key => [key, result])));
}

/** Session-owned receipts survive reflow even when host rows have no concurrency fields. */
export function applyReportSourceMetadata(plan: RenderPlan, metadata: ReadonlyMap<string, ReportEditResult>): RenderPlan {
  if (!metadata.size) return plan;
  function source<T extends Partial<ReportCellSource>>(current: T): T {
    const result = current.datasetId && metadata.get(sourceDatasetKey({ ...current, datasetId: current.datasetId }));
    if (!result) return current;
    if ((result.revision === undefined || Object.is(result.revision, current.revision)) && (result.sourceToken === undefined || result.sourceToken === current.sourceToken)) return current;
    return { ...current, ...(result.revision !== undefined ? { revision: result.revision } : {}), ...(result.sourceToken !== undefined ? { sourceToken: result.sourceToken } : {}) };
  }
  function componentsWithTokens(input: PlanComponent[]): PlanComponent[] {
    const components = input.map((component) => {
      const nextSource = component.table?.source ? source(component.table.source) : undefined;
      const table = component.table && nextSource !== component.table.source ? { ...component.table, source: nextSource } : component.table;
      const cells = component.grid?.cells.map((row) => {
        const next = row.map((cell) => {
          if (!cell) return cell;
          const nextSource = cell.source ? source(cell.source) : undefined;
          const children = cell.children ? componentsWithTokens(cell.children) : undefined;
          return nextSource === cell.source && children === cell.children ? cell : { ...cell, source: nextSource, children };
        });
        return next.some((cell, index) => cell !== row[index]) ? next : row;
      });
      const grid = component.grid && cells?.some((row, index) => row !== component.grid!.cells[index]) ? { ...component.grid, cells: cells! } : component.grid;
      return table !== component.table || grid !== component.grid ? { ...component, table, grid } : component;
    });
    return components.some((component, index) => component !== input[index]) ? components : input;
  }
  const pages = plan.pages.map((page) => {
    const components = componentsWithTokens(page.components);
    return components !== page.components ? { ...page, components } : page;
  });
  return pages.some((page, index) => page !== plan.pages[index]) ? { ...plan, pages } : plan;
}
