import { SCHEMA_VERSION_MACH } from "../defaults";

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

export interface GridCell {
  text?: string;
  rawText?: string;
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
}

export interface PlanComponent {
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
  grid?: PlanGrid;
  style?: ComponentStyle;
  meta?: Record<string, unknown>;
  /** MachReport 扩展字段：未知 kind 的兜底渲染标记 */
  fallbackText?: string;
}

export interface PlanPage {
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
