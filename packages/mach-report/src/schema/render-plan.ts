import { SCHEMA_VERSION_MACH } from "../defaults";
import type { ComponentBinding } from "./component-binding";
import type { CodeOptions } from "./code-options";
export type { CodeOptions } from "./code-options";

export type ComponentKind =
  | "text"
  | "image"
  | "barcode"
  | "qrcode"
  | "chart"
  | "line"
  | "rect"
  | "ellipse";

export interface ComponentStyle {
  fontSizePx?: number;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  backgroundColor?: string;
  align?: "left" | "center" | "right" | "justify";
  verticalAlign?: "top" | "middle" | "bottom";
  lineColor?: string;
  borderColor?: string;
  lineWidthPt?: number;
  borderTop?: boolean;
  borderRight?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
  lineHeight?: number;
  letterSpacing?: number;
  opacity?: number;
  rotateDeg?: number;
}

export interface RichParagraph {
  segments: RichSegment[];
  align?: ComponentStyle["align"];
  lineHeight?: number;
  spaceBeforeMm?: number;
  spaceAfterMm?: number;
  indentMm?: number;
}

export interface RichSegment {
  kind?: "text" | "field";
  text?: string;
  field?: string;
  style?: ComponentStyle;
}

/** 可持久化的业务身份与计划坐标独立；权限及并发校验仍由业务服务器执行。 */
export interface ReportCellSource {
  /** Source identity across report occurrences; sharing must be explicitly declared. */
  sourceScope?: string;
  datasetId: string;
  rowKey: string | number;
  field: string;
  revision?: string | number;
  sourceToken?: string;
}

export interface GridCell {
  text?: string;
  rawText?: string;
  /** 原始值，仅供 Excel raw 模式消费；不参与预览、分页与 PDF 绘制。 */
  value?: string | number | boolean | null;
  /** Excel 数字格式（例如 #,##0.00 / 0.00%），不改变 text。 */
  numberFormat?: string;
  /** Physical left inset for hierarchical labels; raw value stays unchanged. */
  indentMm?: number;
  /** 编辑输入类型；省略时只按原始值推断，数字字符串不会被转换为数值。 */
  valueType?: "text" | "number" | "boolean";
  /** 单元格级编辑控制；预览仍需显式开启 editing。 */
  editable?: boolean;
  source?: ReportCellSource;
  /** SDK 派生结果不映射业务来源，始终只读（包括覆盖同名源字段的计算）。 */
  derived?: boolean;
  /** Excel 公式保留元数据；当前引擎不计算公式，公式格始终只读。 */
  formula?: string;
  children?: PlanComponent[];
  colSpan?: number;
  rowSpan?: number;
  style?: ComponentStyle;
}

export interface PlanGrid {
  /** 行内允许 null 空位；渲染器按空单元格处理 */
  cells: (GridCell | null)[][];
  colWidthsMm?: number[];
  rowHeightsMm?: number[];
  gapMm?: number;
  /** 单元格四边内距；旧静态网格默认 0.5mm，分页列表使用其真实测量内距。 */
  paddingMm?: number;
}

/** 列表的逻辑行来源；用于连续 Excel 重组，避免按文本猜测重复表头。 */
export interface PlanTableFragment {
  /** 在整个计划中唯一的逻辑表身份；同一表的分页片段共享身份。 */
  id: string;
  /** 表头固定 -1；其余行（包括组头/小计/总计）从 0 连续递增。 */
  rowIndex: number;
  role: "header" | "body" | "group-header" | "subtotal" | "grand-total";
  /** 按物理列顺序保存字段身份；不以表头显示文本判断列结构。 */
  columnKeys: string[];
  layout?: "page" | "wide";
  title?: string;
  /** 只有宿主声明稳定 rowKey 时生成，不能用显示顺序替代业务主键。 */
  source?: Omit<ReportCellSource, "field" | "rowKey"> & { rowKey?: string | number };
}

export interface PlanComponent {
  /** Optional QR/barcode encoding configuration; no encoder is loaded by the core. */
  code?: CodeOptions;
  /** Template-only binding; resolved and removed before constructing the output plan. */
  binding?: ComponentBinding;
  /** Template page furniture repeats per page and reserves its vertical band. */
  pageAnchor?: "header" | "footer";
  kind: ComponentKind;
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
  nid?: string;
  rkey?: string;
  text?: string;
  rawText?: string;
  lines?: string[];
  richParagraphs?: RichParagraph[];
  imageData?: string;
  /** 明确指定线段方向；省略保持历史水平线行为。 */
  lineDirection?: "down" | "up";
  grid?: PlanGrid;
  table?: PlanTableFragment;
  style?: ComponentStyle;
  meta?: Record<string, unknown>;
  /** MachReport 扩展字段：未知 kind 的兜底渲染标记 */
  fallbackText?: string;
}

export interface PlanPage {
  meta?: Record<string, unknown>;
  /** wide 表示完整自然列宽；页面仅为预览的垂直窗口分段。 */
  layout?: "page" | "wide";
  pageWidthMm: number;
  pageHeightMm: number;
  marginTopMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  marginRightMm?: number;
  components: PlanComponent[];
}

export interface RenderPlan {
  schemaVersion: string;
  /** 编辑需要模板重算上下文；跨 Worker/JSON 保留要求，但不声明本地会话可用。 */
  requiresRecalculation?: boolean;
  pages: PlanPage[];
}

export const RENDER_PLAN_SCHEMA_VERSION = SCHEMA_VERSION_MACH;

export function isImageBackedComponent(comp: PlanComponent): boolean {
  return (
    (comp.kind === "image" ||
      comp.kind === "barcode" ||
      comp.kind === "qrcode" ||
      comp.kind === "chart") &&
    !!comp.imageData
  );
}

export function isRichText(comp: PlanComponent): boolean {
  return (
    comp.kind === "text" &&
    Array.isArray(comp.richParagraphs) &&
    comp.richParagraphs.length > 0
  );
}
