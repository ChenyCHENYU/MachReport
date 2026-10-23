import type { ReportParamDef, ReportTemplate, TemplateComponent, TemplatePage } from "../layout/paginate";
import type { ReportTemplateRepeat } from "../schema/component-binding";
import { ReportTemplateError, validateReportTemplate } from "../source/template-registry";

/** Each face inherits the label size; declare several faces for front/back or companion labels. */
export type LabelTemplatePage = Pick<TemplatePage, "components" | "meta"> & Partial<Pick<TemplatePage, "widthMm" | "heightMm">>;
export interface LabelTemplateOptions extends ReportTemplateRepeat {
  widthMm?: number;
  heightMm?: number;
  params?: ReportParamDef[];
  /** A single face. Mutually exclusive with pages. */
  components?: TemplateComponent[];
  pages?: LabelTemplatePage[];
}

/** One declaration covers record binding, fixed paper size, copies and ordered multi-face labels. */
export function createLabelTemplate(options: LabelTemplateOptions): ReportTemplate {
  if (options.components !== undefined && options.pages !== undefined) throw new TypeError("标签 components 与 pages 只能选择一种");
  const { dataset, rowKey, copies, params } = options;
  const faces = options.pages ?? [{ components: options.components ?? [] }];
  const template: ReportTemplate = {
    repeat: { dataset, ...(rowKey === undefined ? {} : { rowKey }), ...(copies === undefined ? {} : { copies }) },
    ...(params === undefined ? {} : { params }),
    pages: faces.map(face => ({
      widthMm: face.widthMm ?? options.widthMm ?? 80,
      heightMm: face.heightMm ?? options.heightMm ?? 55,
      marginTopMm: 0, marginRightMm: 0, marginBottomMm: 0, marginLeftMm: 0,
      components: face.components,
      ...(face.meta === undefined ? {} : { meta: face.meta })
    }))
  };
  const result = validateReportTemplate(template);
  if (!result.ok) throw new ReportTemplateError(result.errors);
  return JSON.parse(JSON.stringify(template)) as ReportTemplate;
}
