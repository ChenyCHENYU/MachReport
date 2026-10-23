import { createLocalTemplateCatalog, type ReportTemplateCatalogProvider, type LocalTemplateCatalogItem } from "../source/template-catalog";
import { parseReportTemplate, type ReportTemplateDocument } from "../source/template-registry";
import type { ReportTemplateManager } from "../source/template-store";
import type { ReportDefinition } from "../source/report-source";
import { createReportGenerationService } from "./generation";
import { createReportRuntime } from "./runtime";
import { ReportInstanceError, type ReportInstanceSnapshot, type ReportInstanceStore } from "./instance-store";
import type { ReportBatchCase } from "./batch";
import type { ReportRuntimeOptions, ReportPdfFontOptions } from "./types";
import { throwIfAborted } from "./control";

/** Structural bridge: no Vue/designer dependency is loaded by the workflow. */
export interface ReportWorkflowEditor {
  readonly saving?: boolean;
  readonly blocked?: boolean;
  readonly pendingLocalChanges: boolean;
  save(): void | Promise<void>;
}
export interface ReportWorkflowPublishInput {
  editor: ReportWorkflowEditor;
  document(): ReportTemplateDocument;
  successfulSaves(): number;
  afterSave(): Promise<unknown>;
}
export async function saveAndPublishReportTemplate(manager: ReportTemplateManager, options: ReportWorkflowPublishInput) {
  const intendedId = options.document().id;
  const blocked = () => options.editor.saving || options.editor.blocked;
  if (blocked()) throw new Error("草稿尚未保存，请处理设计器提示后再发布");
  if (options.editor.pendingLocalChanges) {
    const before = options.successfulSaves();
    await options.editor.save(); await options.afterSave();
    if (options.successfulSaves() === before || options.editor.pendingLocalChanges || blocked()) throw new Error("草稿尚未保存，请处理设计器提示后再发布");
  }
  const document = options.document();
  if (document.id !== intendedId) throw new ReportInstanceError("conflict", "当前模板已切换，请重新确认后发布");
  return manager.publish(document.id, { expectedRevision: document.revision ?? null });
}
export function createManagerTemplateCatalog(manager: ReportTemplateManager, metadata?: (document: ReportTemplateDocument) => Pick<LocalTemplateCatalogItem, "category" | "tags">): ReportTemplateCatalogProvider {
  return {
    async search(request) {
      throwIfAborted(request.signal);
      const records = await manager.list(request.signal);
      if (records.length > 1000) throw new RangeError("本地模板连接目录最多 1000 项；更大目录请使用宿主分页查询适配器");
      const items: LocalTemplateCatalogItem[] = [];
      for (const record of records) {
        throwIfAborted(request.signal);
        const [draft, published] = await Promise.all([manager.get(record.id, { draft: true, signal: request.signal }), manager.get(record.id, { signal: request.signal })]);
        const document = draft ?? published;
        if (document) items.push({ document, published, draftRevision: draft?.revision, publishedRevision: published?.revision, ...metadata?.(parseReportTemplate(document)) });
      }
      return createLocalTemplateCatalog(items).search(request);
    },
    async get(id, context) {
      if (context.mode === "published") return manager.get(id, { signal: context.signal });
      return await manager.get(id, { draft: true, signal: context.signal }) ?? manager.get(id, { signal: context.signal });
    },
  };
}
/** Session-local intents; durable hosts should supply their own authorized stable IDs. */
export function createMemoryReportInstanceIds(maximum = 1000) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1000) throw new RangeError("本地生成意图上限应为 1–1000");
  const identities = new Map<string, string>();
  const namespace = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    forCase(templateId: string, caseId: string): string {
      if (![templateId, caseId].every(value => typeof value === "string" && value.length > 0 && value.length <= 256)) throw new TypeError("模板与参数组标识无效");
      const key = JSON.stringify([templateId, caseId]), existing = identities.get(key);
      if (existing) return existing;
      if (identities.size >= maximum) throw new RangeError("本地生成意图已达上限，请使用持久化任务服务");
      const id = `instance-${namespace}-${(identities.size + 1).toString(36)}`;
      identities.set(key, id); return id;
    },
  };
}
export interface ReportWorkflowOptions {
  templates: ReportTemplateManager;
  instances: ReportInstanceStore;
  scope: string;
  data: Omit<ReportDefinition, "template"> | ((document: ReportTemplateDocument) => Omit<ReportDefinition, "template">);
  runtime?: Omit<ReportRuntimeOptions, "reports">;
  pdf?: ReportPdfFontOptions;
  instanceId?(templateId: string, caseId: string): string;
  title?(document: ReportTemplateDocument, item: ReportBatchCase, params: Record<string, string>): string;
  catalog?: ReportTemplateCatalogProvider;
  catalogMetadata?(document: ReportTemplateDocument): Pick<LocalTemplateCatalogItem, "category" | "tags">;
}
function matches(instance: ReportInstanceSnapshot, document: ReportTemplateDocument, params: Record<string, string>): boolean {
  const keys = Object.keys(params);
  return instance.reportIds.length === 1 && instance.reportIds[0] === document.id
    && Object.keys(instance.templateRevisions).length === 1 && instance.templateRevisions[document.id] === document.revision
    && Object.keys(instance.params).length === keys.length && keys.every(key => params[key] === instance.params[key]);
}
function instanceReceipt(instance: ReportInstanceSnapshot) { return { instanceId: instance.id, label: instance.title }; }
function publishedBatch(input: ReportTemplateDocument, options: ReportWorkflowOptions, identity: (templateId: string, caseId: string) => string) {
  const document = parseReportTemplate(input);
  if (!document.revision) throw new Error("请先发布该模板");
  const data = typeof options.data === "function" ? options.data(parseReportTemplate(document)) : options.data;
  const runtime = createReportRuntime({ ...options.runtime, reports: { [document.id]: { ...data, template: document.template } } });
  const service = createReportGenerationService({ runtime, instances: options.instances, templateRevisions: { [document.id]: document.revision }, pdf: options.pdf });
  async function previous(id: string, params: Record<string, string>, signal?: AbortSignal) {
    throwIfAborted(signal);
    const existing = await options.instances.read(options.scope, id, undefined, signal);
    throwIfAborted(signal);
    if (!existing) return;
    if (!matches(existing, document, params)) throw new ReportInstanceError("conflict", "此参数组已用于其他参数或发布修订，请复制为新任务生成");
    return instanceReceipt(existing);
  }
  return {
    document: parseReportTemplate(document),
    async execute(item: ReportBatchCase, { signal }: { signal?: AbortSignal }) {
      throwIfAborted(signal);
      const checked = runtime.validate({ reportIds: [document.id], params: item.params });
      if (!checked.ok) throw new Error(checked.issues[0]?.message ?? "生成参数无效");
      const id = identity(document.id, item.id), existing = await previous(id, checked.values, signal);
      if (existing) return existing;
      try {
        return instanceReceipt(await service.generate({ scope: options.scope, id,
          title: (options.title?.(parseReportTemplate(document), item, checked.values) ?? `${document.name} · ${item.id}`).slice(0, 512),
          reportIds: [document.id], params: checked.values, expectedRevision: null, signal }));
      } catch (cause) {
        if (cause instanceof ReportInstanceError && cause.code === "conflict") {
          const committed = await previous(id, checked.values, signal);
          if (committed) return committed;
        }
        throw cause;
      }
    },
  };
}
/** Optional package-owned catalog → draft publication → immutable batch/instance wiring. */
export function createReportWorkflow(options: ReportWorkflowOptions) {
  options = { ...options };
  const identities = createMemoryReportInstanceIds(), identity = options.instanceId ?? identities.forCase;
  return {
    catalog: options.catalog ?? createManagerTemplateCatalog(options.templates, options.catalogMetadata),
    publish: (input: ReportWorkflowPublishInput) => saveAndPublishReportTemplate(options.templates, input),
    /** Resolve only a manager-owned publication, then keep that exact revision for this batch. */
    async batch(id: string, request: { expectedRevision?: string; signal?: AbortSignal } = {}) {
      const { expectedRevision, signal } = request;
      const document = await options.templates.get(id, { signal });
      throwIfAborted(signal);
      if (!document?.revision) throw new Error("请先发布该模板");
      if (expectedRevision !== undefined && document.revision !== expectedRevision) throw new ReportInstanceError("conflict", "模板发布版本已变化，请重新打开后生成");
      return publishedBatch(document, options, identity);
    },
  };
}
