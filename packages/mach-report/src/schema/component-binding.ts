import type { ColumnFormat } from "../format";

/** The same declarative formatting used by list columns, before any output backend. */
export type ValueFormat = ColumnFormat;

/** A literal own field of the current label record; expressions and paths are not evaluated. */
export interface ComponentBinding {
  field: string;
  format?: ValueFormat;
  prefix?: string;
  suffix?: string;
  emptyText?: string;
}

/** Every record emits its copies, each containing all template pages in their original order. */
export interface ReportTemplateRepeat {
  dataset: string;
  rowKey?: string;
  /** Whole copies per record, 1..1000. The field value must be a number, never a numeric string. */
  copies?: number | { field: string };
}
