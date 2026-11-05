import type { ReportTemplateDocument } from "./template-registry";

export const MAX_TEMPLATE_JSON_CHARACTERS = 10_000_000;

/** Internal only. Callers must validate the document before serializing it. */
export function stringifyValidatedTemplate(document: ReportTemplateDocument): string {
  const json = JSON.stringify(document, null, 2);
  if (json.length > MAX_TEMPLATE_JSON_CHARACTERS)
    throw new RangeError("模板 JSON 超过 1000 万字符的导出/导入上限");
  return json;
}
