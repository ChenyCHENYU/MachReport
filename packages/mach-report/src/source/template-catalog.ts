import { parseReportTemplate, type ReportTemplateDocument, type ReportTemplateSummary } from "./template-registry";

export interface ReportTemplateCatalogEntry extends ReportTemplateSummary {
  category?: string; tags?: string[]; updatedAt?: string;
  /** Optional lifecycle metadata. revision continues to identify the editable document. */
  draftRevision?: string;
  publishedRevision?: string;
}
export interface ReportTemplateCatalogOpenContext { mode: "edit" | "published" }
export interface ReportTemplateCatalogPage { items: ReportTemplateCatalogEntry[]; next?: string; categories?: Array<{ id: string; label: string; count?: number }> }
export interface ReportTemplateCatalogQuery { query?: string; category?: string; cursor?: string; limit?: number; signal?: AbortSignal }
/** Discovery metadata is separate from executable templates and from enterprise account authorization. */
export interface ReportTemplateCatalogProvider {
  search(request: ReportTemplateCatalogQuery): Promise<ReportTemplateCatalogPage>;
  get(id: string, context: { signal?: AbortSignal; mode?: ReportTemplateCatalogOpenContext["mode"] }): Promise<ReportTemplateDocument | undefined>;
}
export interface LocalTemplateCatalogItem {
  /** Editable document: prefer the latest draft; otherwise use the published document. */
  document: ReportTemplateDocument;
  published?: ReportTemplateDocument;
  draftRevision?: string;
  publishedRevision?: string;
  category?: string;
  tags?: string[];
}
function lifecycle(item: LocalTemplateCatalogItem, document: ReportTemplateDocument): Pick<ReportTemplateCatalogEntry, "draftRevision" | "publishedRevision"> {
  const publishedRevision = item.publishedRevision ?? item.published?.revision;
  for (const value of [item.draftRevision, publishedRevision]) if (value !== undefined && (typeof value !== "string" || !value.trim())) throw new TypeError("模板生命周期修订应为非空字符串");
  if (item.draftRevision !== undefined && item.draftRevision !== document.revision) throw new TypeError("可编辑文档应与草稿修订一致");
  if (item.published && (item.published.id !== document.id || item.published.revision !== publishedRevision)) throw new TypeError("发布文档身份或修订不一致");
  if (!item.published && publishedRevision !== undefined && publishedRevision !== document.revision) throw new TypeError("发布修订需要对应的独立文档");
  return { ...(item.draftRevision === undefined ? {} : { draftRevision: item.draftRevision }), ...(publishedRevision === undefined ? {} : { publishedRevision }) };
}
export function cloneReportTemplate(document: ReportTemplateDocument, identity: { id: string; name: string }): ReportTemplateDocument {
  const snapshot = parseReportTemplate(document);
  if (identity.id === snapshot.id) throw new Error("复制模板应使用新的 ID");
  const { revision: _revision, ...source } = snapshot;
  return parseReportTemplate({ ...source, id: identity.id, name: identity.name });
}
/** Local catalog reference; an enterprise host supplies the same search/get contract with server filtering. */
export function createLocalTemplateCatalog(input: LocalTemplateCatalogItem[]): ReportTemplateCatalogProvider {
  if (!Array.isArray(input) || input.length > 1000) throw new RangeError("本地模板目录最多 1000 项");
  const documents = new Map<string, ReportTemplateDocument>(), published = new Map<string, ReportTemplateDocument>(), entries: ReportTemplateCatalogEntry[] = [];
  for (const item of input) {
    const document = parseReportTemplate(item.document);
    if (documents.has(document.id)) throw new Error(`模板 ID 重复：${document.id}`);
    if (item.category !== undefined && (typeof item.category !== "string" || item.category.length > 128) || item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.length > 20 || item.tags.some(tag => typeof tag !== "string" || tag.length > 128))) throw new TypeError("模板分类和标签无效");
    const versions = lifecycle(item, document);
    const { template: _template, ...summary } = document;
    documents.set(document.id, document);
    if (item.published) published.set(document.id, parseReportTemplate(item.published));
    else if (versions.publishedRevision) published.set(document.id, parseReportTemplate(document));
    entries.push({ ...summary, ...versions, ...(item.category ? { category: item.category } : {}), ...(item.tags ? { tags: [...item.tags] } : {}) });
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
    get: async (id, context) => { abort(context.signal); const document = context.mode === "published" ? published.get(id) : documents.get(id); return document ? parseReportTemplate(document) : undefined; }
  };
}
function abort(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("模板目录操作已取消"); error.name = "AbortError"; throw error;
}
