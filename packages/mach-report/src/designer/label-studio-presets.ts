import type { DatasetContract } from "@agile-team/mach-report";

export type LabelStudioPreset = "material" | "paired" | "warehouse";

export interface LabelStudioBrand {
  name?: string;
  tagline?: string;
  /** Portable image data shared by preview, PDF and image output. */
  logoData?: string;
}

export interface LabelStudioLayout {
  preset?: LabelStudioPreset;
  brand?: LabelStudioBrand;
  fields?: readonly string[];
}

export const LABEL_STUDIO_PRESETS = [
  { id: "material", widthMm: 80, heightMm: 55, faces: 1 },
  { id: "paired", widthMm: 80, heightMm: 55, faces: 2 },
  { id: "warehouse", widthMm: 100, heightMm: 60, faces: 1 },
] as const;

export function labelIdentityField(schema: DatasetContract, explicit?: string): string | undefined {
  return explicit
    ?? schema.fields.find(field => field.semanticRole === "identifier" && field.field !== schema.rowKey)?.field
    ?? schema.rowKey
    ?? schema.fields[0]?.field;
}

/** Declared semantic roles guide defaults; equally ranked fields retain contract order. */
export function labelDisplayFields(schema: DatasetContract, identity?: string, selected?: readonly string[]) {
  const candidates = schema.fields.filter(field => field.field !== identity && field.field !== schema.rowKey);
  if (selected === undefined)
    return candidates.map((field, index) => ({ field, index, priority: displayPriority(field) }))
      .sort((left, right) => left.priority - right.priority || left.index - right.index)
      .slice(0, 5).map(item => item.field);
  const fields = new Map(candidates.map(field => [field.field, field]));
  const keys = [...new Set(selected)];
  if (keys.length > 5) throw new Error("成品标签最多显示 5 个字段，请先精简显示字段");
  return keys.map(key => {
    const field = fields.get(key);
    if (!field) throw new Error(`标签显示字段未在业务契约中声明：${key}`);
    return field;
  });
}

function displayPriority(field: DatasetContract["fields"][number]): number {
  if (/^(?:name|title|label|category)$/i.test(field.field) || /名称|品名|品类|类别/.test(field.label ?? "")) return 0;
  if (field.semanticRole === "dimension") return 1;
  if (field.semanticRole === "measure" && field.unit) return 2;
  if (field.semanticRole === "identifier") return 3;
  if (field.semanticRole === "date") return 4;
  return 5;
}

export function labelPreset(id: LabelStudioPreset = "paired") {
  return LABEL_STUDIO_PRESETS.find(preset => preset.id === id) ?? LABEL_STUDIO_PRESETS[1];
}
