import type { ListColumn, ListComponent, ReportTemplate, TemplatePage } from "../layout/paginate";
import type { ComponentStyle, PlanComponent } from "../schema/render-plan";

type Geometry = Partial<Pick<PlanComponent, "leftMm" | "topMm" | "widthMm" | "heightMm">>;

export class TemplateBuilder {
  readonly pages: TemplatePage[] = [];
  private pending: PageBuilder | null = null;

  page(
    widthMm = 210,
    heightMm = 297,
    margins: Partial<Pick<TemplatePage, "marginTopMm" | "marginBottomMm" | "marginLeftMm" | "marginRightMm">> = {}
  ): PageBuilder {
    this.collect();
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
    return { pages: this.pages };
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
