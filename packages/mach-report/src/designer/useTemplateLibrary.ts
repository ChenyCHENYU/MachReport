import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { cloneReportTemplate, parseReportTemplate, type ReportTemplateCatalogEntry, type ReportTemplateCatalogPage, type ReportTemplateCatalogProvider, type ReportTemplateCatalogOpenContext, type ReportTemplateDocument } from "@agile-team/mach-report";
import { TEMPLATE_LIBRARY_MESSAGES, type TemplateLibraryMessages } from "./library-messages";

export interface TemplateLibraryOptions {
  provider: ReportTemplateCatalogProvider;
  messages?: Partial<TemplateLibraryMessages>;
  /** Optional real persistence action. No copy button is shown without it. */
  create?: (document: ReportTemplateDocument, context: { signal: AbortSignal }) => Promise<ReportTemplateDocument>;
}
interface SearchIntent { query: string; category?: string; cursor?: string; more: boolean; previous: boolean }
interface LoadIntent {
  entry: ReportTemplateCatalogEntry;
  mode: ReportTemplateCatalogOpenContext["mode"];
  copy: boolean;
  identity: { id: string; name: string };
  create?: TemplateLibraryOptions["create"];
  candidate?: ReportTemplateDocument;
  savedDocument?: ReportTemplateDocument;
}
function validEntry(item: ReportTemplateCatalogEntry): boolean {
  if (!item || typeof item.id !== "string" || !item.id.trim() || typeof item.name !== "string" || !item.name.trim()) return false;
  if ([item.draftRevision, item.publishedRevision].some(value => value !== undefined && (typeof value !== "string" || !value.trim()))) return false;
  return item.tags === undefined || Array.isArray(item.tags) && item.tags.length <= 20 && item.tags.every(tag => typeof tag === "string");
}
function validatePage(page: ReportTemplateCatalogPage): void {
  if (!page || !Array.isArray(page.items) || page.items.length > 100 || page.next !== undefined && (typeof page.next !== "string" || !page.next || page.next.length > 4096)) throw new Error("invalid");
  const ids = new Set<string>();
  for (const item of page.items) {
    if (!validEntry(item) || ids.has(item.id)) throw new Error("invalid");
    ids.add(item.id);
  }
  if (page.categories !== undefined && (!Array.isArray(page.categories) || page.categories.length > 1000 || page.categories.some(item => !item || typeof item.id !== "string" || !item.id || typeof item.label !== "string"))) throw new Error("invalid");
}
/** Paging, operation-specific retries and lifecycle intent remain inside the optional designer package. */
export function useTemplateLibrary(props: TemplateLibraryOptions, open: (document: ReportTemplateDocument, context?: ReportTemplateCatalogOpenContext) => void) {
  const m = computed(() => ({ ...TEMPLATE_LIBRARY_MESSAGES, ...props.messages }));
  const query = ref(""), category = ref(""), entries = shallowRef<ReportTemplateCatalogEntry[]>([]), categories = shallowRef<NonNullable<ReportTemplateCatalogPage["categories"]>>([]);
  const cursors = ref<Array<string | undefined>>([undefined]);
  const next = ref<string>(), loading = ref(false), busy = ref(false), error = ref("");
  const copying = shallowRef<ReportTemplateCatalogEntry>(), newId = ref(""), newName = ref("");
  const errorKind = ref<"search" | "open" | "copy">("search"), loadingTarget = ref("");
  const retryAction = shallowRef<() => Promise<void>>();
  let generation = 0, action = 0, controller: AbortController | undefined, actionController: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const retryLabel = computed(() => ({ search: m.value.retrySearch, open: m.value.retryOpen, copy: m.value.retryCopy })[errorKind.value]);
  function clearError(): void { error.value = ""; retryAction.value = undefined; }
  function applyPage(page: ReportTemplateCatalogPage, intent: SearchIntent): void {
    validatePage(page);
    if (page.next !== undefined && (page.next === intent.cursor || !intent.previous && cursors.value.includes(page.next))) throw new Error(m.value.stale);
    entries.value = page.items.map(item => ({ ...item, ...(item.tags ? { tags: [...item.tags] } : {}) })); next.value = page.next;
    if (intent.previous) cursors.value = cursors.value.slice(0, -1);
    else if (intent.more) cursors.value = [...cursors.value, intent.cursor];
    if (page.categories) categories.value = page.categories;
  }
  function searchError(cause: unknown): string {
    if (cause instanceof Error) return cause.message === "invalid" ? m.value.invalid : cause.message;
    return String(cause);
  }
  async function searchPage(intent: SearchIntent): Promise<void> {
    clearTimeout(timer); controller?.abort(); const current = ++generation;
    const requestController = new AbortController(); controller = requestController; loading.value = true; clearError();
    if (!intent.more && !intent.previous) { entries.value = []; next.value = undefined; cursors.value = [undefined]; }
    try {
      const page = await props.provider.search({ query: intent.query, category: intent.category, cursor: intent.cursor, limit: 30, signal: requestController.signal });
      if (current !== generation) return;
      applyPage(page, intent);
    } catch (cause) {
      if (current === generation && !requestController.signal.aborted) { error.value = searchError(cause); errorKind.value = "search"; retryAction.value = () => searchPage(intent); }
    } finally { if (current === generation) loading.value = false; }
  }
  async function search(more = false, previous = false): Promise<void> {
    if (more && !next.value || previous && cursors.value.length < 2) return;
    await searchPage({ query: query.value.trim(), category: category.value || undefined, cursor: previous ? cursors.value.at(-2) : more ? next.value : undefined, more, previous });
  }
  async function loadDocument(intent: LoadIntent, signal: AbortSignal, current: number): Promise<ReportTemplateDocument | undefined> {
    if (intent.savedDocument) return parseReportTemplate(intent.savedDocument);
    if (intent.candidate) return parseReportTemplate(intent.candidate);
    const result = await props.provider.get(intent.entry.id, { signal, mode: intent.mode });
    if (current !== action) return;
    if (!result || result.id !== intent.entry.id) throw new Error(m.value.missing);
    const document = parseReportTemplate(result);
    if (intent.mode === "published" && intent.entry.publishedRevision !== document.revision) throw new Error(m.value.publicationChanged);
    if (!intent.copy) return document;
    intent.candidate = cloneReportTemplate(document, intent.identity);
    return parseReportTemplate(intent.candidate);
  }
  async function performLoad(intent: LoadIntent): Promise<void> {
    if (busy.value) return;
    const current = ++action, requestController = new AbortController(); actionController = requestController;
    busy.value = true; clearError(); loadingTarget.value = (intent.copy && !intent.savedDocument ? m.value.creatingTarget : m.value.openingTarget).replace("{name}", intent.savedDocument?.name ?? intent.entry.name);
    try {
      let document = await loadDocument(intent, requestController.signal, current);
      if (!document || current !== action) return;
      if (intent.copy && !intent.savedDocument) {
        if (!intent.create) return;
        document = parseReportTemplate(await intent.create(document, { signal: requestController.signal }));
        if (current !== action) return;
        if (document.id !== intent.identity.id) throw new Error(m.value.invalid);
        intent.savedDocument = parseReportTemplate(document);
        copying.value = undefined;
      }
      open(document, { mode: intent.mode });
      if (intent.copy) void search();
    } catch (cause) {
      if (current === action && !requestController.signal.aborted) { error.value = searchError(cause); errorKind.value = intent.copy && !intent.savedDocument ? "copy" : "open"; retryAction.value = () => performLoad(intent); }
    } finally { if (current === action) { busy.value = false; loadingTarget.value = ""; } }
  }
  async function load(entry: ReportTemplateCatalogEntry, copy = false, mode: ReportTemplateCatalogOpenContext["mode"] = "edit"): Promise<void> {
    await performLoad({ entry: { ...entry }, copy, mode: copy ? "edit" : mode, identity: { id: newId.value.trim(), name: newName.value.trim() }, create: props.create });
  }
  function invalidateSearch(): void {
    generation++; controller?.abort(); entries.value = []; next.value = undefined; cursors.value = [undefined]; loading.value = true; clearError();
    clearTimeout(timer); timer = setTimeout(() => { void search(); }, 180);
  }
  function resetProvider(): void { action++; actionController?.abort(); busy.value = false; loadingTarget.value = ""; copying.value = undefined; void search(); }
  watch([query, category], invalidateSearch);
  watch([() => props.provider, () => props.create], resetProvider);
  watch([newId, newName], () => { if (errorKind.value === "copy") clearError(); });
  onBeforeUnmount(() => { generation++; action++; clearTimeout(timer); controller?.abort(); actionController?.abort(); });
  void search();
  return { m, cursors, query, category, entries, categories, next, loading, busy, error, errorKind, retryLabel, loadingTarget, copying, newId, newName, search, load,
    retry: async () => { if (!busy.value && !loading.value) await retryAction.value?.(); },
    beginCopy: (entry: ReportTemplateCatalogEntry) => { clearError(); copying.value = entry; newId.value = ""; newName.value = entry.name; },
    cancelCopy: () => { if (!busy.value) { copying.value = undefined; clearError(); } }
  };
}
