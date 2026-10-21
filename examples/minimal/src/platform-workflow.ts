import {
  createLocalTemplateCatalog,
  parseReportTemplate,
  type DatasetRows,
  type ReportTemplateCatalogProvider,
  type ReportTemplateDocument,
  type ReportTemplateManager,
} from "@agile-team/mach-report";
import {
  createReportGenerationService,
  createReportRuntime,
  ReportInstanceError,
  type ReportBatchCase,
  type ReportInstanceSnapshot,
  type ReportInstanceStore,
} from "@agile-team/mach-report/server";
import type { TemplateEditorController } from "@agile-team/mach-report/designer";

/** Dirty editors must finish a real save; an already persisted clean draft can publish directly. */
export async function saveAndPublishTemplate(options: {
  editor: TemplateEditorController;
  manager: ReportTemplateManager;
  document: () => ReportTemplateDocument;
  successfulSaves: () => number;
  afterSave: () => Promise<unknown>;
}) {
  if (options.editor.saving || options.editor.blocked) throw new Error("草稿尚未保存，请处理设计器提示后再发布");
  if (options.editor.pendingLocalChanges) {
    const before = options.successfulSaves();
    await options.editor.save(); await options.afterSave();
    if (options.successfulSaves() === before || options.editor.pendingLocalChanges || options.editor.saving || options.editor.blocked) throw new Error("草稿尚未保存，请处理设计器提示后再发布");
  }
  const document = options.document();
  return options.manager.publish(document.id, { expectedRevision: document.revision ?? null });
}

/** A stable provider reads current state on every operation; it never caches an old publication over a newer draft. */
export function createManagerTemplateCatalog(manager: ReportTemplateManager): ReportTemplateCatalogProvider {
  return {
    async search(request) {
      const records = await manager.list(request.signal);
      const items = [];
      for (const record of records) {
        const [draft, published] = await Promise.all([
          manager.get(record.id, { draft: true, signal: request.signal }),
          manager.get(record.id, { signal: request.signal }),
        ]);
        const document = draft ?? published;
        if (document) items.push({ document, published, draftRevision: draft?.revision, publishedRevision: published?.revision,
          category: "生产运营", tags: ["多区域", "树形汇总"] });
      }
      return createLocalTemplateCatalog(items).search(request);
    },
    async get(id, context) {
      if (context.mode === "published") return manager.get(id, { signal: context.signal });
      return await manager.get(id, { draft: true, signal: context.signal }) ?? manager.get(id, { signal: context.signal });
    },
  };
}

/** Session-local opaque identities. A tuple avoids concatenation collisions and the fixed capacity bounds retained intent metadata. */
export function createLocalInstanceIdentities(maximum = 1000) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1000) throw new RangeError("本地生成意图上限应为 1–1000");
  const identities = new Map<string, string>();
  return {
    forCase(templateId: string, caseId: string): string {
      if (![templateId, caseId].every(value => typeof value === "string" && value.length > 0 && value.length <= 256)) throw new TypeError("模板与参数组标识无效");
      const key = JSON.stringify([templateId, caseId]), existing = identities.get(key);
      if (existing) return existing;
      if (identities.size >= maximum) throw new RangeError("本地生成意图已达上限，请使用持久化任务服务");
      const id = `instance-${(identities.size + 1).toString(36)}`;
      identities.set(key, id); return id;
    },
  };
}

function sameParams(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}
function matchingInstance(existing: ReportInstanceSnapshot, document: ReportTemplateDocument, params: Record<string, string>): boolean {
  return existing.reportIds.length === 1 && existing.reportIds[0] === document.id
    && Object.keys(existing.templateRevisions).length === 1 && existing.templateRevisions[document.id] === document.revision
    && sameParams(existing.params, params);
}
function receipt(instance: ReportInstanceSnapshot) { return { instanceId: instance.id, label: instance.title }; }

/** Each executor closes over one immutable publication. A retry can reuse only the same parameters and publication. */
export function createLocalPublishedBatch(input: ReportTemplateDocument, datasets: DatasetRows, store: ReportInstanceStore, identities: ReturnType<typeof createLocalInstanceIdentities>) {
  const document = parseReportTemplate(input);
  if (!document.revision) throw new Error("请先发布该模板");
  const runtime = createReportRuntime({ reports: { [document.id]: { template: document.template, datasets } } });
  const service = createReportGenerationService({ runtime, instances: store, templateRevisions: { [document.id]: document.revision } });
  async function existingReceipt(id: string, params: Record<string, string>, signal: AbortSignal) {
    const existing = await store.read("local-demo", id, undefined, signal);
    if (!existing) return;
    if (!matchingInstance(existing, document, params)) throw new ReportInstanceError("conflict", "此参数组已用于其他参数或发布修订，请复制为新任务生成");
    return receipt(existing);
  }
  return {
    document: parseReportTemplate(document),
    async execute(item: ReportBatchCase, { signal }: { signal: AbortSignal }) {
      const checked = runtime.validate({ reportIds: [document.id], params: item.params });
      if (!checked.ok) throw new Error(checked.issues[0]?.message ?? "生成参数无效");
      const id = identities.forCase(document.id, item.id), previous = await existingReceipt(id, checked.values, signal);
      if (previous) return previous;
      try {
        const result = await service.generate({ scope: "local-demo", id, title: `${document.name} · ${checked.values.month ?? item.id}`.slice(0, 512),
          reportIds: [document.id], params: checked.values, expectedRevision: null, signal });
        return receipt(result);
      } catch (cause) {
        if (cause instanceof ReportInstanceError && cause.code === "conflict") {
          const committed = await existingReceipt(id, checked.values, signal);
          if (committed) return committed;
        }
        throw cause;
      }
    },
  };
}
