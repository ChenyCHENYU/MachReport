import { computed, nextTick, ref, watch } from "vue";
import type { useTemplateEditor } from "./useTemplateEditor";
import type { useTemplateWorkspace } from "./useTemplateWorkspace";
import type { useTemplateInspector, TemplateInspectorSection } from "./useTemplateInspector";

/** Targets, tool visibility and unapplied configuration move together, independently of rendering. */
export function useDesignerNavigation(editor: ReturnType<typeof useTemplateEditor>, workspace: ReturnType<typeof useTemplateWorkspace>, inspector: ReturnType<typeof useTemplateInspector>, host: { id: string; readonly(): boolean }) {
  const { lists, selected, jsonPending, saving, blocked, validation, pendingLocalChanges, messages: m } = editor;
  const { section } = inspector;
  const { mode, tool, canvasPage, setMode: setWorkspaceMode, chooseCanvas: chooseCanvasUnchecked, locateReview: locateReviewUnchecked } = workspace;
  const { id } = host;
  const sections = computed<TemplateInspectorSection[]>(() => [
    ...(lists.value.length ? ["fields" as const] : []),
    "component",
    "template",
    "tools",
    "advanced",
  ]);
  const dockedTools = ref(new Set(["outline", "reuse"]));
  const toolPreview = computed(() => section.value === "tools" && dockedTools.value.has(tool.value));
  function setMode(next: "design" | "preview"): void {
    if (toolPreview.value) mode.value = next;
    else setWorkspaceMode(next);
  }
  watch([section, tool], () => { if (toolPreview.value) mode.value = "design"; });
  function toggleToolPreview(): void {
    const next = new Set(dockedTools.value);
    if (next.has(tool.value)) next.delete(tool.value); else next.add(tool.value);
    dockedTools.value = next;
    if (next.has(tool.value)) mode.value = "design";
  }
  function chooseToolComponent(event: Event): void {
    const index = Number((event.target as HTMLSelectElement).value);
    if (Number.isInteger(index) && index >= 0) void chooseCanvas({ pageIndex: canvasPage.value, componentIndex: index });
  }
  function openBinding(): void { section.value = "tools"; tool.value = "excel"; }
  type PendingTarget = "excel" | "rules" | "params" | "json";
  const pendingConfigurations = computed(() => {
    const tools = (["excel", "rules", "params"] as const)
      .filter(item => editor.pendingTools.value.includes(item))
      .map(target => ({ target: target as PendingTarget, label: m.value[`${target}Tool`] }));
    if (jsonPending.value) tools.push({ target: "json", label: m.value.json });
    return tools;
  });
  const saveReason = computed(() => {
    if (saving.value) return m.value.saving;
    if (host.readonly()) return m.value.saveReadonly;
    if (blocked.value) return m.value.saveConfirmation;
    if (pendingConfigurations.value.length) return pendingConfigurations.value.map(item => `${item.label} · ${m.value.unapplied}`).join("；");
    if (!validation.value.ok) return m.value.saveInvalid;
    return pendingLocalChanges.value ? "" : m.value.saveUnchanged;
  });
  async function openPending(target: PendingTarget): Promise<void> {
    if (target === "json") section.value = "advanced";
    else { section.value = "tools"; tool.value = target; }
    await nextTick();
    const selector = target === "json" ? `#${id}-panel-advanced textarea` : `#${id}-tool-${target}`;
    document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }
  const headingStatus = computed(() =>
    saving.value
      ? m.value.saving
      : host.readonly()
        ? m.value.readonly
        : pendingLocalChanges.value
          ? m.value.dirty
          : m.value.ready,
  );
  let targetRevision = 0;
  async function chooseCanvas(selection: Parameters<typeof chooseCanvasUnchecked>[0]): Promise<void> {
    const revision = ++targetRevision;
    const keepTool = section.value === "tools";
    const target = lists.value.findIndex(item => item.pageIndex === selection.pageIndex && item.componentIndex === selection.componentIndex);
    if (target >= 0 && target !== selected.value && editor.isToolPending("rules") && !await editor.guardChanges()) return;
    if (revision !== targetRevision) return;
    chooseCanvasUnchecked(selection);
    if (keepTool) section.value = "tools";
  }
  async function locateReview(location: Parameters<typeof locateReviewUnchecked>[0]): Promise<void> {
    const revision = ++targetRevision;
    const keepTool = section.value === "tools" && tool.value === "outline";
    const path = /\.pages\[(\d+)\]\.components\[(\d+)\]/.exec(location.path ?? "");
    const pageIndex = location.pageIndex ?? (path ? Number(path[1]) : undefined), componentIndex = location.componentIndex ?? (path ? Number(path[2]) : undefined);
    const target = lists.value.findIndex(item => item.pageIndex === pageIndex && item.componentIndex === componentIndex);
    if (target >= 0 && target !== selected.value && editor.isToolPending("rules") && !await editor.guardChanges()) return;
    if (revision !== targetRevision) return;
    locateReviewUnchecked(location);
    if (keepTool) section.value = "tools";
  }
  async function chooseRuleList(event: Event): Promise<void> {
    const revision = ++targetRevision;
    const target = event.target as HTMLSelectElement, next = Number(target.value);
    if (editor.isToolPending("rules") && !await editor.guardChanges()) { target.value = String(selected.value); return; }
    if (revision === targetRevision) selected.value = next;
  }
  async function navigateSection(event: KeyboardEvent): Promise<void> {
    if (event.isComposing || event.keyCode === 229) return;
    const keys: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      Home: -sections.value.length,
      End: sections.value.length,
    };
    const delta = keys[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const current = sections.value.indexOf(section.value);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? sections.value.length - 1
          : (current + delta + sections.value.length) % sections.value.length;
    section.value = sections.value[next]!;
    const tabs = (event.currentTarget as HTMLElement).parentElement;
    await nextTick();
    tabs
      ?.querySelector<HTMLButtonElement>(`#${id}-tab-${section.value}`)
      ?.focus();
  }
  return { sections, toolPreview, setMode, toggleToolPreview, chooseToolComponent, openBinding, pendingConfigurations, saveReason, openPending, headingStatus, chooseCanvas, locateReview, chooseRuleList, navigateSection };
}
