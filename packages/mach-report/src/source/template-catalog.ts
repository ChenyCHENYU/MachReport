import { parseReportTemplate, type ReportTemplateDocument, type ReportTemplateSummary } from "./template-registry";

export interface ReportTemplateCatalogEntry extends ReportTemplateSummary { category?: string; tags?: string[]; updatedAt?: string }
export interface ReportTemplateCatalogPage { items: ReportTemplateCatalogEntry[]; next?: string; categories?: Array<{ id: string; label: string; count?: number }> }
export interface ReportTemplateCatalogQuery { query?: string; category?: string; cursor?: string; limit?: number; signal?: AbortSignal }
/** Discovery metadata is separate from executable templates and from enterprise account authorization. */
export interface ReportTemplateCatalogProvider {
  search(request: ReportTemplateCatalogQuery): Promise<ReportTemplateCatalogPage>;
  get(id: string, context: { signal?: AbortSignal }): Promise<ReportTemplateDocument | undefined>;
}
export function cloneReportTemplate(document: ReportTemplateDocument, identity: { id: string; name: string }): ReportTemplateDocument {
  const snapshot = parseReportTemplate(document);
  if (identity.id === snapshot.id) throw new Error("复制模板应使用新的 ID");
  const { revision: _revision, ...source } = snapshot;
  return parseReportTemplate({ ...source, id: identity.id, name: identity.name });
}
/** Local catalog reference; an enterprise host supplies the same search/get contract with server filtering. */
export function createLocalTemplateCatalog(input: Array<{ document: ReportTemplateDocument; category?: string; tags?: string[] }>): ReportTemplateCatalogProvider {
  if (!Array.isArray(input) || input.length > 1000) throw new RangeError("本地模板目录最多 1000 项");
  const documents = new Map<string, ReportTemplateDocument>(), entries: ReportTemplateCatalogEntry[] = [];
  for (const item of input) {
    const document = parseReportTemplate(item.document);
    if (documents.has(document.id)) throw new Error(`模板 ID 重复：${document.id}`);
    if (item.category !== undefined && (typeof item.category !== "string" || item.category.length > 128) || item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.length > 20 || item.tags.some(tag => typeof tag !== "string" || tag.length > 128))) throw new TypeError("模板分类和标签无效");
    const { template: _template, ...summary } = document;
    documents.set(document.id, document);
    entries.push({ ...summary, ...(item.category ? { category: item.category } : {}), ...(item.tags ? { tags: [...item.tags] } : {}) });
  }
  entries.sort((a, b) => a.id < b.id ? -1 : 1);
  return {
    search: async (request) => {
      abort(request.signal);
      const limit = request.limit ?? 30;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("模板每页数量应为 1–100");
      const query = request.query?.trim().toLocaleLowerCase() ?? "";
      const filtered = entries.filter(item => (!request.category || item.category === request.category) && (!request.cursor || item.id > request.cursor) && (!query || [item.id, item.name, item.description, ...(item.tags ?? [])].some(value => value?.toLocaleLowerCase().includes(query))));
      const counts = new Map<string, number>();
      for (const item of entries) if (item.category) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
      return JSON.parse(JSON.stringify({ items: filtered.slice(0, limit), ...(filtered.length > limit ? { next: filtered[limit - 1]!.id } : {}), categories: Array.from(counts, ([id, count]) => ({ id, label: id, count })) })) as ReportTemplateCatalogPage;
    },
    get: async (id, context) => { abort(context.signal); const document = documents.get(id); return document ? parseReportTemplate(document) : undefined; }
  };
}
function abort(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("模板目录操作已取消"); error.name = "AbortError"; throw error;
}
