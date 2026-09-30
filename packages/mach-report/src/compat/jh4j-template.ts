import type { ReportTemplate, TemplatePage } from "../layout/paginate";
import type {
  ComponentStyle,
  PlanComponent,
  PlanGrid
} from "../schema/render-plan";

export interface Jh4jImportResult {
  template: ReportTemplate;
  warnings: string[];
}

type Raw = Record<string, unknown>;

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mapAlign(h: string): ComponentStyle["align"] {
  if (h === "Center") return "center";
  if (h === "Right") return "right";
  return "left";
}

function mapVAlign(v: string): ComponentStyle["verticalAlign"] {
  if (v === "Center") return "middle";
  if (v === "Bottom") return "bottom";
  return "top";
}

function baseStyle(node: Raw): ComponentStyle {
  const fontSize = parseFloat(str(node["FontSize"], "10.5"));
  return {
    fontSize: Number.isFinite(fontSize) ? fontSize : 10.5,
    fontFamily: str(node["FontFamily"], "黑体") || undefined,
    bold: str(node["FontWeight"]) === "bold" || undefined,
    italic: str(node["FontStyle"]) === "italic" || undefined,
    underline: node["Underline"] === true || undefined,
    color: str(node["FontColor"]) || undefined,
    backgroundColor: str(node["BackgroundColor"]) || undefined,
    align: mapAlign(str(node["HorAlignment"], "Left")),
    verticalAlign: mapVAlign(str(node["VertAlignment"], "Top")),
    lineHeight: (() => {
      const lh = parseFloat(str(node["RowSpace"], "1"));
      return Number.isFinite(lh) && lh !== 1 ? lh : undefined;
    })(),
    borderColor: str(node["BorderColor"]) || undefined,
    borderTop: node["BorderTop"] !== false,
    borderRight: node["BorderRight"] !== false,
    borderBottom: node["BorderBottom"] !== false,
    borderLeft: node["BorderLeft"] !== false
  };
}

function convertElement(node: Raw, warnings: string[]): PlanComponent | null {
  const uitype = str(node["uitype"]);
  const comp: PlanComponent = {
    kind: "text",
    leftMm: num(node["left"], 0),
    topMm: num(node["top"], 0),
    widthMm: num(node["width"], 40),
    heightMm: num(node["height"], 8),
    nid: str(node["nid"]) || undefined,
    style: baseStyle(node)
  };
  switch (uitype) {
    case "text": {
      comp.kind = "text";
      const text = node["Text"] ?? node["text"] ?? node["Value"];
      comp.text = text == null ? "" : String(text);
      const lines = node["Lines"] ?? node["lines"];
      if (Array.isArray(lines)) {
        comp.lines = lines.map((l) => String(l));
      }
      return comp;
    }
    case "richtext":
      comp.kind = "text";
      comp.text = str(node["Text"]);
      warnings.push(`富文本 ${comp.nid ?? ""} 导入为纯文本（版式细节可能损失）`);
      return comp;
    case "image":
    case "barcode":
    case "qrcode":
    case "chart":
      comp.kind = uitype === "image" ? "image" : (uitype as PlanComponent["kind"]);
      comp.fallbackText = `[${uitype}]`;
      warnings.push(`图片类组件 ${comp.nid ?? ""} 需运行时数据（imageData），已导入为占位`);
      return comp;
    case "table": {
      comp.kind = "rect";
      const cellsRaw = node["Cells"] ?? node["cells"];
      if (Array.isArray(cellsRaw)) {
        const grid: PlanGrid = {
          cells: cellsRaw.map((row) =>
            Array.isArray(row)
              ? row.map((cell) => ({
                  text: isRaw(cell) ? str(cell["Text"] ?? cell["text"]) : "",
                  colSpan: isRaw(cell) ? num(cell["ColSpan"], 1) : 1
                }))
              : []
          )
        };
        comp.grid = grid;
      } else {
        comp.fallbackText = "[table]";
        warnings.push(`表格 ${comp.nid ?? ""} 缺少 Cells，导入为空框`);
      }
      return comp;
    }
    case "subreport":
      warnings.push(`子报表 ${comp.nid ?? ""} 暂不支持导入，已跳过`);
      return null;
    default: {
      if (str(node["ShapeType"]) === "hline" || uitype === "hline") {
        comp.kind = "line";
        return comp;
      }
      if (uitype === "vline") {
        comp.kind = "line";
        return comp;
      }
      if (uitype === "rect" || uitype === "oval" || uitype === "shape") {
        comp.kind = uitype === "oval" ? "ellipse" : "rect";
        return comp;
      }
      warnings.push(`未知组件类型 ${uitype}，已跳过`);
      return null;
    }
  }
}

/**
 * jh4j 模板 content（exportBackendPrintConfig 产物，见 docs/reverse-findings.md §6）
 * → MachReport ReportTemplate。单向转换，未知结构降级 + 告警，绝不抛错。
 */
export function importJh4jTemplateContent(content: string | Raw): Jh4jImportResult {
  const warnings: string[] = [];
  let root: Raw | null = null;
  if (typeof content === "string") {
    try {
      const parsed: unknown = JSON.parse(content);
      if (isRaw(parsed)) root = parsed;
    } catch {
      return {
        template: { pages: [] },
        warnings: ["content 不是合法 JSON"]
      };
    }
  } else if (isRaw(content)) {
    root = content;
  }
  if (!root) {
    return { template: { pages: [] }, warnings: ["content 为空"] };
  }

  const globalConfig = isRaw(root["GlobalConfig"]) ? root["GlobalConfig"] : {};
  const defaultWidth = num(globalConfig["paperWidthMm"], 210);
  const defaultHeight = num(globalConfig["paperHeightMm"], 297);
  const defaultMargins = {
    top: num(globalConfig["marginTop"], 10),
    bottom: num(globalConfig["marginBottom"], 10),
    left: num(globalConfig["marginLeft"], 10),
    right: num(globalConfig["marginRight"], 10)
  };

  const pageNodes = Array.isArray(root["children"])
    ? root["children"].filter((c) => isRaw(c) && str(c["uitype"]) === "page")
    : [];

  if (pageNodes.length === 0) {
    warnings.push("content 中没有 uitype=page 的页节点");
  }

  const pages: TemplatePage[] = pageNodes.map((raw) => {
    const node = raw as Raw;
    const elements = Array.isArray(node["children"]) ? node["children"] : [];
    const components: PlanComponent[] = [];
    for (const el of elements) {
      if (!isRaw(el)) continue;
      const converted = convertElement(el, warnings);
      if (converted) components.push(converted);
    }
    return {
      widthMm: num(node["width"], defaultWidth),
      heightMm: num(node["DesignHeight"], defaultHeight),
      marginTopMm: num(node["MarginTop"], defaultMargins.top),
      marginBottomMm: num(node["MarginBottom"], defaultMargins.bottom),
      marginLeftMm: num(node["MarginLeft"], defaultMargins.left),
      marginRightMm: num(node["MarginRight"], defaultMargins.right),
      components
    };
  });

  if (pages.length === 0) {
    warnings.push("转换结果为空页，已回退一张空白页");
    pages.push({
      widthMm: defaultWidth,
      heightMm: defaultHeight,
      ...defaultMargins,
      components: []
    });
  }

  return { template: { pages }, warnings };
}
