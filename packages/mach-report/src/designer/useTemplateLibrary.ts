import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { cloneReportTemplate, parseReportTemplate, type ReportTemplateCatalogEntry, type ReportTemplateCatalogPage, type ReportTemplateCatalogProvider, type ReportTemplateDocument } from "@agile-team/mach-report";
import { TEMPLATE_LIBRARY_MESSAGES, type TemplateLibraryMessages } from "./library-messages";

export interface TemplateLibraryOptions {
  provider: ReportTemplateCatalogProvider;
  messages?: Partial<TemplateLibraryMessages>;
  /** Optional real persistence action. No copy button is shown without it. */
  create?: (document: ReportTemplateDocument, context: { signal: AbortSignal }) => Promise<ReportTemplateDocument>;
}
function validatePage(page: ReportTemplateCatalogPage): void {
  if (!page || !Array.isArray(page.items) || page.items.length > 100 || page.next !== undefined && (typeof page.next !== "string" || !page.next || page.next.length > 4096)) throw new Error("invalid");
  const ids = new Set<string>();
  for (const item of page.items) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || typeof item.name !== "string" || !item.name.trim() || ids.has(item.id)) throw new Error("invalid");
    ids.add(item.id);
  }
  if (page.categories !== undefined && (!Array.isArray(page.categories) || page.categories.length > 1000 || page.categories.some(item => !item || typeof item.id !== "string" || !item.id || typeof item.label !== "string"))) throw new Error("invalid");
}
/** Remote paging, cancellation and stale-result suppression live inside the optional designer package. */
export function useTemplateLibrary(props: TemplateLibraryOptions, open: (document: ReportTemplateDocument) => void) {
  const m = computed(() => ({ ...TEMPLATE_LIBRARY_MESSAGES, ...props.messages }));
  const query = ref(""), category = ref(""), entries = shallowRef<ReportTemplateCatalogEntry[]>([]), categories = shallowRef<NonNullable<ReportTemplateCatalogPage["categories"]>>([]);
  const cursors = ref<Array<string | undefined>>([undefined]);
  const next = ref<string>(), loading = ref(false), busy = ref(false), error = ref("");
  const copying = shallowRef<ReportTemplateCatalogEntry>(), newId = ref(""), newName = ref("");
  let generation = 0, action = 0, controller: AbortController | undefined, actionController: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  function applyPage(page: ReportTemplateCatalogPage, cursor: string | undefined, more: boolean, previous: boolean): void {
    validatePage(page);
    if (page.next !== undefined && (page.next === cursor || !previous && cursors.value.includes(page.next))) throw new Error(m.value.stale);
    entries.value = page.items; next.value = page.next;
    if (previous) cursors.value = cursors.value.slice(0, -1);
    else if (more) cursors.value = [...cursors.value, cursor];
    if (page.categories) categories.value = page.categories;
  }
  function searchError(cause: unknown): string {
    if (cause instanceof Error) return cause.message === "invalid" ? m.value.invalid : cause.message;
    return String(cause);
  }
  async function search(more = false, previous = false): Promise<void> {
    if (more && !next.value || previous && cursors.value.length < 2) return;
    clearTimeout(timer); controller?.abort(); const current = ++generation;
    controller = new AbortController(); loading.value = true; error.value = "";
    const cursor = previous ? cursors.value.at(-2) : more ? next.value : undefined;
    if (!more && !previous) { entries.value = []; next.value = undefined; cursors.value = [undefined]; }
    try {
      const page = await props.provider.search({ query: query.value.trim(), category: category.value || undefined, cursor, limit: 30, signal: controller.signal });
      if (current !== generation) return;
      applyPage(page, cursor, more, previous);
    } catch (cause) { if (current === generation && !controller.signal.aborted) error.value = searchError(cause); }
    finally { if (current === generation) loading.value = false; }
  }
  async function load(entry: ReportTemplateCatalogEntry, copy = false): Promise<void> {
    if (busy.value) return;
    const current = ++action, create = props.create, identity = { id: newId.value.trim(), name: newName.value.trim() }; actionController = new AbortController(); busy.value = true; error.value = "";
    try {
      const result = await props.provider.get(entry.id, { signal: actionController.signal });
      if (current !== action) return;
      if (!result || result.id !== entry.id) throw new Error(m.value.missing);
      const document = parseReportTemplate(result);
      if (copy) {
        if (!create) return;
        const candidate = cloneReportTemplate(document, identity);
        const saved = parseReportTemplate(await create(candidate, { signal: actionController.signal }));
        if (current !== action) return;
        if (saved.id !== candidate.id) throw new Error(m.value.invalid);
        copying.value = undefined; open(saved); void search();
      } else open(document);
    } catch (cause) { if (current === action && !actionController.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause); }
    finally { if (current === action) busy.value = false; }
  }
  watch([query, category], () => { generation++; controller?.abort(); entries.value = []; next.value = undefined; cursors.value = [undefined]; loading.value = true; clearTimeout(timer); timer = setTimeout(() => { void search(); }, 180); });
  watch([() => props.provider, () => props.create], () => { action++; actionController?.abort(); busy.value = false; copying.value = undefined; void search(); });
  onBeforeUnmount(() => { generation++; action++; clearTimeout(timer); controller?.abort(); actionController?.abort(); });
  void search();
  return { m, cursors, query, category, entries, categories, next, loading, busy, error, copying, newId, newName, search, load,
    beginCopy: (entry: ReportTemplateCatalogEntry) => { copying.value = entry; newId.value = ""; newName.value = entry.name; }
  };
}
