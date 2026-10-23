import type { DatasetRows, ReportTemplate } from "../layout/paginate";
import type { DatasetContract } from "../schema/dataset";
import { defineReport, ReportSourceError, type ReportDefinition, type ReportLoadContext } from "./report-source";
import { ReportTemplateError, validateReportTemplate } from "./template-registry";

/** Named business row interfaces and readonly arrays need no index signature or conversion. */
export type LabelReportRows = readonly object[];

interface LabelReportDefinitionBase extends Pick<ReportDefinition, "params" | "pagination" | "dataValidation"> {
  /** An existing fixed label template. Its repeat.dataset supplies the dataset name. */
  template: ReportTemplate;
  /** The single label dataset's contract; no dataset-name wrapper is needed. */
  dataSchema?: DatasetContract;
}

export type LabelReportDefinitionOptions = LabelReportDefinitionBase & (
  | { rows: LabelReportRows; load?: never }
  | { rows?: never; load: (context: ReportLoadContext) => LabelReportRows | Promise<LabelReportRows> }
);

function labelDataset(template: ReportTemplate): string {
  if (!template || typeof template !== "object" || !template.repeat) {
    throw new ReportSourceError("config", "defineLabelReport 需要带 repeat 的固定标签模板");
  }
  const validation = validateReportTemplate(template);
  if (!validation.ok) throw new ReportTemplateError(validation.errors);
  return template.repeat.dataset;
}

function rowsDataset(rows: LabelReportRows, dataset: string): DatasetRows {
  if (!Array.isArray(rows)) throw new ReportSourceError("validate", "标签数据应为对象数组；请从业务响应中提取行数组");
  // Source validation checks every row before layout. The source and pagination only read
  // the array; keeping its identity avoids copying a large result for this small adapter.
  return { [dataset]: rows as Record<string, unknown>[] };
}

/**
 * Flat label integration for the same Vue/Node source pipeline: template + rows/load.
 * It maps the one dataset and optional contract without caching or converting business values.
 * Dynamic templates and multiple datasets continue to use defineReport.
 */
export function defineLabelReport(options: LabelReportDefinitionOptions): ReportDefinition {
  const { template, rows, load, dataSchema, params, pagination, dataValidation } = options;
  const dataset = labelDataset(template);
  if ((rows !== undefined) === (load !== undefined) || (load !== undefined && typeof load !== "function")) {
    throw new ReportSourceError("config", "标签报表应且只能配置 rows 或 load 其中一种数据来源");
  }
  const definition = { template, params, pagination, dataValidation, ...(dataSchema === undefined ? {} : { dataSchema: { [dataset]: dataSchema } }) };
  if (load) return defineReport({ ...definition, load, mapData: result => rowsDataset(result, dataset) });
  return { ...definition, datasets: rowsDataset(rows!, dataset) };
}
