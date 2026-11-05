import {
  createLabelTemplate,
  defineReportTemplate,
  type DatasetContract,
  type PlanComponent,
  type ReportTemplateDocument,
} from "@agile-team/mach-report";
import {
  labelDisplayFields,
  labelIdentityField,
  labelPreset,
  type LabelStudioLayout,
} from "./label-studio-presets";

const ink = "#173450";
const muted = "#586c82";

type LabelField = DatasetContract["fields"][number];

function text(value: string, x: number, y: number, width: number, height = 4, size = 7): PlanComponent {
  return {
    kind: "text", text: value, leftMm: x, topMm: y, widthMm: width, heightMm: height,
    style: { fontSize: size, lineHeight: 1.1, color: ink, verticalAlign: "middle" },
  };
}

function line(y: number, width: number): PlanComponent {
  return {
    kind: "line", leftMm: 4, topMm: y, widthMm: width - 8, heightMm: 0.2,
    style: { lineColor: "#c9d7e5", lineWidthPt: 0.55 },
  };
}

function header(title: string, width: number, brand?: LabelStudioLayout["brand"]): PlanComponent[] {
  const components: PlanComponent[] = [];
  let left = 4;
  if (brand?.logoData) {
    if (!/^data:image\/(?:png|jpeg);base64,/i.test(brand.logoData))
      throw new Error("标签Logo须使用PNG或JPEG图片数据");
    components.push({ kind: "image", leftMm: 4, topMm: 3, widthMm: 12, heightMm: 7, imageData: brand.logoData, meta: { labelBrandLogo: true } });
    left = 19;
  }
  components.push({ ...text(brand?.name?.trim() || title, left, 3, width - left - 4, 5, 9), style: { fontSize: 9, color: "#205582" } });
  if (brand?.tagline?.trim())
    components.push({ ...text(brand.tagline.trim(), left, 8, width - left - 4, 3, 5.5), style: { fontSize: 5.5, color: muted } });
  components.push(line(12, width));
  return components;
}

function details(fields: LabelField[], top: number, labelWidth: number, valueWidth: number, gap = 4.7): PlanComponent[] {
  return fields.flatMap((field, index) => {
    const y = top + index * gap;
    return [
      { ...text(field.label ?? field.field, 4, y, labelWidth, 4, 6), style: { fontSize: 6, color: muted } },
      { ...text("", 4 + labelWidth, y, valueWidth, 4, 7), binding: { field: field.field, ...(field.format ? { format: field.format } : {}) } },
    ];
  });
}

function identityTitle(identity: string | undefined, width: number): PlanComponent[] {
  return identity ? [{ ...text("", 4, 14, width, 7, 14), binding: { field: identity }, style: { fontSize: 14, color: ink } }] : [];
}

function materialFace(schema: DatasetContract, title: string, identity: string | undefined, layout: LabelStudioLayout): PlanComponent[] {
  const fields = labelDisplayFields(schema, identity, layout.fields);
  const components = [
    ...header(title, 80, layout.brand),
    ...identityTitle(identity, 71),
    ...details(fields, 23, 21, 27),
  ];
  if (identity) components.push({ kind: "qrcode", leftMm: 55, topMm: 23, widthMm: 20, heightMm: 20, binding: { field: identity }, code: { quietZoneModules: 4, errorCorrection: "M" } });
  components.push(line(48, 80));
  const identityLabel = schema.fields.find(field => field.field === identity)?.label ?? title;
  components.push({ ...text(identityLabel, 4, 49, 71, 3, 5.8), style: { fontSize: 5.8, color: muted } });
  return components;
}

function warehouseFace(schema: DatasetContract, title: string, identity: string | undefined, layout: LabelStudioLayout, width = 80): PlanComponent[] {
  const components = header(title, width, layout.brand);
  if (identity) {
    components.push({ ...text("", 4, 14, width - 8, 8, 16), binding: { field: identity }, style: { fontSize: 16, align: "center", color: ink } });
    components.push({ kind: "qrcode", leftMm: (width - 20) / 2, topMm: 23, widthMm: 20, heightMm: 20, binding: { field: identity }, code: { quietZoneModules: 4, errorCorrection: "M" } });
  }
  components.push(line(44, width));
  const fields = labelDisplayFields(schema, identity, layout.fields);
  if (width === 100) {
    fields.forEach((field, index) => {
      const left = index % 2 === 0 ? 4 : 52;
      const top = 46 + Math.floor(index / 2) * 4.3;
      components.push({ ...text(field.label ?? field.field, left, top, 19, 3.7, 5.8), style: { fontSize: 5.8, color: muted } });
      components.push({ ...text("", left + 19, top, 25, 3.7, 6.5), binding: { field: field.field, ...(field.format ? { format: field.format } : {}) } });
    });
  } else components.push(...details(fields.slice(0, 1), 46, 24, width - 32, 5));
  return components;
}

/** Finished layouts use declared fields and original values; custom documents stay host controlled. */
export function createLabelStudioDocument(schema: DatasetContract, title: string, identityField?: string, layout: LabelStudioLayout = {}): ReportTemplateDocument {
  const identity = labelIdentityField(schema, identityField);
  const preset = labelPreset(layout.preset);
  // The existing image component owns Logo bytes; metadata retains only small settings.
  const brand = Object.fromEntries(["name", "tagline"].flatMap(key => {
    const value = layout.brand?.[key as keyof NonNullable<LabelStudioLayout["brand"]>];
    return typeof value === "string" ? [[key, value]] : [];
  }));
  const settings = { preset: preset.id, brand, fields: labelDisplayFields(schema, identity, layout.fields).map(field => field.field) };
  const front = preset.id === "warehouse"
    ? warehouseFace(schema, title, identity, layout, preset.widthMm)
    : materialFace(schema, title, identity, layout);
  const pages = [{ widthMm: preset.widthMm, heightMm: preset.heightMm, meta: { title: `${title} · 1`, labelStudio: settings }, components: front }];
  if (preset.faces === 2)
    pages.push({ widthMm: preset.widthMm, heightMm: preset.heightMm, meta: { title: `${title} · 2`, labelStudio: settings }, components: warehouseFace(schema, title, identity, layout) });
  return defineReportTemplate({ id: "record-label", name: title, template: createLabelTemplate({ dataset: "records", rowKey: schema.rowKey, pages }) });
}
