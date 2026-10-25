import type { PlanGrid } from "../schema/render-plan";
import type { CrossTableResult } from "./cross-table";
import type { AggregateOperation } from "./aggregate";

export type MatrixDimensionValue = string | number | boolean | null;
export type MatrixDimensionOrder = "source" | "asc" | "desc";
export interface MatrixAxisOptions {
  /** Display names in the same outer-to-inner order as the dimension fields. */
  labels?: readonly string[];
  /** Per-level sibling order; omitted levels retain first-seen order. */
  sort?: readonly MatrixDimensionOrder[];
  /** One-based prefix depths. Leaf depths are not subtotals. */
  subtotals?: readonly number[];
}
export interface MatrixHierarchyOptions {
  row?: MatrixAxisOptions;
  column?: MatrixAxisOptions;
  /** Only null/missing values use this label; empty strings and zero stay distinct. */
  emptyLabel?: string;
  subtotalLabel?: string;
  totalLabel?: string;
}
export interface MatrixDimensionMember {
  /** Typed field/value identity, independent of labels, source order and display indices. */
  key: string;
  kind: "member" | "subtotal" | "total";
  depth: number;
  /** Prefix predicates. Empty for grand totals; never business write identities. */
  fields: string[];
  values: MatrixDimensionValue[];
  labels: string[];
}
export interface MatrixColumnMember extends MatrixDimensionMember {
  field: string;
  measure: number;
  measureField: string;
  valueField: string;
  operation: AggregateOperation;
}
export interface MatrixTableMetadata {
  rowFields: string[];
  rowLabels: string[];
  columnFields: string[];
  columnLabels: string[];
  /** Aligned with result.rows. */
  rows: MatrixDimensionMember[];
  /** Measure columns only, addressed by their generated field. */
  columns: MatrixColumnMember[];
}
export interface MatrixTableResult extends CrossTableResult {
  /** Present only for opt-in hierarchy; the paginator supplies final physical widths/styles. */
  headerGrid?: PlanGrid;
  metadata?: MatrixTableMetadata;
}
