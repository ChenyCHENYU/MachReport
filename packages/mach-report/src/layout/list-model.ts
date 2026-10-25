import type { ColumnVisual } from "./column-visual";
import type { AggregateDefinition } from "../processing/aggregate";
import type { ComponentStyle, GridCell, PlanGrid } from "../schema/render-plan";
import type { ColumnFormat, StyleRule } from "../format";
import type { ComputedField } from "../processing/computed";
import type { MatrixTableOptions } from "../processing/matrix";
import type { TreeTableOptions } from "../processing/tree";

/** auto：真实数字/显式数值格式居右，日期与布尔居中，其他内容居左。 */
export type ListAlignment = NonNullable<ComponentStyle["align"]> | "auto";

export interface ListColumn {
  header: string;
  field: string;
  widthMm: number;
  style?: ComponentStyle;
  /** 内容对齐，优先于 style.align；数值字符串不会自动判为数字。 */
  align?: ListAlignment;
  /** 独立的表头对齐，不改变内容对齐。 */
  headerAlign?: ComponentStyle["align"];
  /** 独立的表头样式，优先于列表级表头样式。 */
  headerStyle?: ComponentStyle;
  /** 值格式化（声明式）：千分位/小数位、百分比、日期 pattern */
  format?: ColumnFormat;
  /** 条件格式规则（声明式，命中合并进单元格样式；如负数红字） */
  rules?: StyleRule[];
  /** Optional resolved color scale or value-preserving data bar. */
  visual?: ColumnVisual;
  /** 内容列编辑控制；仍需由预览显式开启 editing，不影响表头/小计只读规则。 */
  editable?: boolean;
  /** 空值列或特殊数据类型可显式声明编辑输入类型。 */
  valueType?: GridCell["valueType"];
  /** 字段语义用于 auto 对齐；明确声明编号，避免把数字编号当成度量。 */
  semanticRole?: "identifier" | "dimension" | "measure" | "date" | "text";
  hidden?: boolean;
  /** Condition hides cell content, preserving its physical layout in preview and exports. */
  visibleWhen?: StyleRule["when"];
}

/** 分组小计配置（声明式，见 ListComponent.groupBy） */
export interface ListGroupBy {
  /** 分组字段（值变化即切组） */
  field: string;
  /** 组头文案模板，{value} 占位（默认 "{value}"） */
  headerTemplate?: string;
  headerStyle?: ComponentStyle;
  /** 需要小计的列字段（组尾输出合计行；数值列求和，其余输出首值/留空） */
  subtotal?: string[];
  subtotalStyle?: ComponentStyle;
  subtotalLabel?: string;
  /** 组头防孤行（默认 true：页尾放不下"组头+首行"时整体换页） */
  keepWithNext?: boolean;
  aggregates?: AggregateDefinition[];
  /** Repeat this group heading after page breaks within the group. */
  repeatHeader?: boolean;
}

export type ListGrandTotal =
  | boolean
  | {
      label?: string;
      style?: ComponentStyle;
      /** 合计列（缺省沿用 groupBy.subtotal） */
      fields?: string[];
      aggregates?: AggregateDefinition[];
    };

export interface ListComponent {
  kind: "list";
  /** Opaque serializable layout annotations; interpreted only by explicit optional adapters. */
  meta?: Record<string, unknown>;
  id?: string;
  /** 宽表标记用于连续 Excel；不改变低层列表的列宽和分页算法。 */
  layout?: "page" | "wide";
  /** 逻辑表名称，供 Excel Sheet 命名；不额外生成标题组件。 */
  title?: string;
  leftMm: number;
  topMm: number;
  widthMm: number;
  dataset: string;
  /** Headerless record/region bindings do not allocate a synthetic list header. */
  header?: boolean;
  /** A fixed record region rejects multiple rows instead of dropping source data. */
  cardinality?: "record";
  /** 数据集中稳定业务主键的字段名；省略时编辑仅有计划内坐标。 */
  rowKey?: string;
  revisionField?: string;
  sourceTokenField?: string;
  columns: ListColumn[];
  fontSizePt?: number;
  headerBold?: boolean;
  rowHeightMm?: number;
  paddingMm?: number;
  headerEveryPage?: boolean;
  headerBackgroundColor?: string;
  /** 内容默认对齐，列配置可覆盖；低层模板缺省仍为 left。 */
  align?: ListAlignment;
  /** 表头默认对齐，列配置可覆盖。 */
  headerAlign?: ComponentStyle["align"];
  headerStyle?: ComponentStyle;
  /** 可选多行合并表头；列宽按列表物理列对齐，供 Excel 业务模板复用。 */
  headerGrid?: PlanGrid;
  border?: boolean;
  /** 分组小计（组头/组尾小计/组头防孤行） */
  groupBy?: ListGroupBy;
  /** Ordered outer-to-inner grouping; groupBy remains the single-level shorthand. */
  groups?: ListGroupBy[];
  computed?: ComputedField[];
  /** Dynamic pivot of the current source dataset, with read-only derived identities. */
  matrix?: MatrixTableOptions;
  /** Full ordered hierarchy; source parent values and descendant-leaf rollups are explicit. */
  tree?: TreeTableOptions;
  /** Explicit row visibility; hidden rows do not participate in summaries. */
  rowVisibleWhen?: StyleRule["when"];
  /** Master/detail relation is keyed by business identity, never by display row index. */
  detail?: ListDetail;
  /** 末尾总合计行（依赖 groupBy.subtotal 或显式 fields） */
  grandTotal?: ListGrandTotal;
}

export interface ListDetail {
  dataset: string;
  parentKey: string;
  foreignKey: string;
  rowKey?: string;
  /** 子表独立的并发契约；省略时不继承主表字段。 */
  revisionField?: string;
  sourceTokenField?: string;
  columns: ListColumn[];
  rowHeightMm?: number;
  header?: boolean;
  label?: string;
  /** Unmatched children fail by default; opt-in ignore is explicit. */
  unmatched?: "error" | "ignore";
}
