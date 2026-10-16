import type { ReportCellContext, ReportCellFieldOptions } from "../editing";
import type { ReportEditingOptions } from "./editing";

/** Resolve only on an edit operation; no subscriptions are allocated for individual cells. */
export function resolveCellField(context: ReportCellContext, options: ReportEditingOptions): ReportCellFieldOptions | undefined {
  const fields = options.fields;
  if (typeof fields === "function") return fields(context);
  const key = context.source?.field ?? context.table?.columnKey;
  return key === undefined || !fields || !Object.prototype.hasOwnProperty.call(fields, key) ? undefined : fields[key];
}
