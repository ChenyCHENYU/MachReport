import type { ListColumn, ListComponent, ReportTemplate, TemplatePage } from "../layout/paginate";
import type { ComponentStyle, PlanComponent } from "../schema/render-plan";
import { PAPER_SIZES } from "../units";

type Geometry = Partial<Pick<PlanComponent, "leftMm" | "topMm" | "widthMm" | "heightMm">>;

/** 纸张预设名（对齐 PAPER_SIZES 表） */
export type PaperName = keyof typeof PAPER_SIZES;

export interface PageOptions {
  /** 横向（宽高互换） */
  landscape?: boolean;
  margins?: Partial<
    Pick<TemplatePage, "marginTopMm" | "marginBottomMm" | "marginLeftMm" | "marginRightMm">
  >;
}

type PageMargins = Partial<
  Pick<TemplatePage, "marginTopMm" | "marginBottomMm" | "marginLeftMm" | "marginRightMm">
>;

/** 解析纸张参数：数字按宽高使用；字符串查 PAPER_SIZES 预设；缺省 A4 纵向 */
export function resolvePaper(
  paper: PaperName | { widthMm: number; heightMm: number } | number,
  heightArg?: number,
  landscape?: boolean
): { widthMm: number; heightMm: number } {
  let widthMm: number;
  let heightMm: number;
  if (typeof paper === "string") {
    const preset = PAPER_SIZES[paper];
    if (!preset) throw new Error(`未知纸张预设 "${paper}"（可用：${Object.keys(PAPER_SIZES).join("/")}）`);
    widthMm = preset.widthMm;
    heightMm = preset.heightMm;
  } else if (typeof paper === "number") {
    widthMm = paper;
    heightMm = heightArg ?? 297;
  } else {
    widthMm = paper.widthMm;
    heightMm = paper.heightMm;
  }
  return landscape ? { widthMm: heightMm, heightMm: widthMm } : { widthMm, heightMm };
}

export class TemplateBuilder {
  readonly pages: TemplatePage[] = [];
  private pending: PageBuilder | null = null;
  private templateParams: ReportTemplate["params"] = undefined;

  /**
   * 声明报表参数（链式，可放在 .page() 前后任意位置）：
   * 渲染组件据此自动生成查询面板（也可由 paramDefs prop 提供，prop 优先）。
   *
   * ```ts
   * createTemplate()
   *   .params([
   *     { field: "whCode", label: "仓库", type: "select", options: [...], required: true },
   *     { field: "date", label: "日期", type: "date", defaultValue: "2026-09-30" }
   *   ])
   *   .page("a4").text(...).list(...)
   *   .build();
   * ```
   */
  params(defs: NonNullable<ReportTemplate["params"]>): this {
    this.templateParams = defs;
    return this;
  }

  /**
   * 新建页。纸张支持三种写法：
   * - 预设名：.page("a4", { landscape: true, margins: {...} })
   * - 数字：.page(210, 297)（第三参数兼容旧 margins 对象或新 options）
   * - 对象：.page({ widthMm: 210, heightMm: 297 })
   */
  page(
    paper: PaperName | { widthMm: number; heightMm: number } | number = "a4",
    optionsOrHeight: number | PageOptions = {},
    maybeOptions?: PageOptions | PageMargins
  ): PageBuilder {
    this.collect();
    // 旧签名兼容：.page(w, h, { marginTopMm }) 的第三参数是 margins 本体
    const legacyMargins =
      maybeOptions != null &&
      !("margins" in maybeOptions) &&
      !("landscape" in maybeOptions) &&
      ("marginTopMm" in maybeOptions ||
        "marginBottomMm" in maybeOptions ||
        "marginLeftMm" in maybeOptions ||
        "marginRightMm" in maybeOptions);
    const options: PageOptions = legacyMargins
      ? { margins: maybeOptions as PageMargins }
      : ((maybeOptions as PageOptions | undefined) ?? {});
    const { widthMm, heightMm } = resolvePaper(
      paper,
      typeof optionsOrHeight === "number" ? optionsOrHeight : undefined,
      options.landscape
    );
    const margins = options.margins ?? {};
    this.pending = new PageBuilder(this, {
      widthMm,
      heightMm,
      marginTopMm: margins.marginTopMm ?? 10,
      marginBottomMm: margins.marginBottomMm ?? 10,
      marginLeftMm: margins.marginLeftMm ?? 10,
      marginRightMm: margins.marginRightMm ?? 10
    });
    return this.pending;
  }

  collect(): void {
    if (this.pending) {
      this.pages.push(this.pending.buildPage());
      this.pending = null;
    }
  }

  build(): ReportTemplate {
    this.collect();
    if (this.pages.length === 0) {
      throw new Error("模板至少需要一页：先调用 .page() 添加内容");
    }
    return this.templateParams ? { params: this.templateParams, pages: this.pages } : { pages: this.pages };
  }
}

export class PageBuilder {
  private components: TemplatePage["components"] = [];

  constructor(
    private readonly parent: TemplateBuilder,
    private readonly page: Omit<TemplatePage, "components">
  ) {}

  text(content: string, geometry: Geometry = {}, style: ComponentStyle = {}): this {
    this.components.push({
      kind: "text",
      leftMm: geometry.leftMm ?? 0,
      topMm: geometry.topMm ?? 0,
      widthMm: geometry.widthMm ?? 60,
      heightMm: geometry.heightMm ?? 8,
      text: content,
      style
    });
    return this;
  }

  list(
    dataset: string,
    geometry: Partial<Pick<ListComponent, "leftMm" | "topMm" | "widthMm">>,
    columns: ListColumn[],
    options: Partial<
      Omit<ListComponent, "kind" | "leftMm" | "topMm" | "widthMm" | "dataset" | "columns">
    > = {}
  ): this {
    this.components.push({
      kind: "list",
      leftMm: geometry.leftMm ?? 10,
      topMm: geometry.topMm ?? 30,
      widthMm: geometry.widthMm ?? 180,
      dataset,
      columns,
      ...options
    });
    return this;
  }

  rect(
    geometry: Required<Pick<PlanComponent, "leftMm" | "topMm" | "widthMm" | "heightMm">>,
    style: ComponentStyle = {}
  ): this {
    this.components.push({ kind: "rect", ...geometry, style });
    return this;
  }

  line(leftMm: number, topMm: number, widthMm: number, style: ComponentStyle = {}): this {
    this.components.push({
      kind: "line",
      leftMm,
      topMm,
      widthMm,
      heightMm: 0.5,
      style
    });
    return this;
  }

  barcode(content: string, geometry: Required<Geometry>): this {
    this.components.push({
      kind: "barcode",
      leftMm: geometry.leftMm ?? 0,
      topMm: geometry.topMm ?? 0,
      widthMm: geometry.widthMm ?? 40,
      heightMm: geometry.heightMm ?? 12,
      fallbackText: content
    });
    return this;
  }

  qrcode(content: string, sizeMm: number, leftMm: number, topMm: number): this {
    this.components.push({
      kind: "qrcode",
      leftMm,
      topMm,
      widthMm: sizeMm,
      heightMm: sizeMm,
      fallbackText: content
    });
    return this;
  }

  buildPage(): TemplatePage {
    return { ...this.page, components: this.components };
  }

  done(): TemplateBuilder {
    return this.parent;
  }

  build(): ReportTemplate {
    return this.done().build();
  }
}

export function createTemplate(): TemplateBuilder {
  return new TemplateBuilder();
}
