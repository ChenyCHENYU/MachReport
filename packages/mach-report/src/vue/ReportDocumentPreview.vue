<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import type { RenderPlan } from "../schema/render-plan";
import type { ReportDocumentManifest } from "../server/document-store";
import type { ReportDocumentSource } from "../server/document-source";
import type { ReportRuntimeExportResult } from "../server/types";
import { assertReportExportResult } from "../server/execution-result";
import { assertOutputActive, waitForOutput } from "../output/progress";
import ReportPreview from "./ReportPreview.vue";
import ReportPagination from "./ReportPagination.vue";
import ReportExportMenu from "./ReportExportMenu.vue";
import { resolveConfig, themeToCssVars, useMachReportConfig, type MachReportMessages } from "./config";
import { DEFAULT_DOCUMENT_MESSAGES } from "./document-messages";
import { createDocumentWindowReader } from "./document-window";
import { cloneReportSnapshot } from "./snapshot";
import { MachReportError } from "./errors";

const props = withDefaults(defineProps<{ source: ReportDocumentSource; height?: string; messages?: Partial<MachReportMessages>; preset?: string }>(), { height: "100vh", messages: undefined, preset: undefined });
const emit = defineEmits<{ (event: "loaded", manifest: Readonly<ReportDocumentManifest>): void; (event: "error", message: string): void; (event: "exported", result: ReportRuntimeExportResult): void }>();
const config = useMachReportConfig();
const resolved = computed(() => resolveConfig(config.value, props.preset));
const messages = computed(() => ({ ...DEFAULT_DOCUMENT_MESSAGES, ...resolved.value.messages, ...props.messages }));
const manifest = shallowRef<ReportDocumentManifest>(), plan = shallowRef<RenderPlan>();
const currentPage = ref(1), loading = ref(false), exporting = ref(false), error = ref(""), stale = ref(false);
let reader = createDocumentWindowReader(props.source), sequence = 0, mounted = false, loadController: AbortController | undefined, exportController: AbortController | undefined;
const fetcher = async () => cloneReportSnapshot(plan.value!);
const reportKey = ref("");
const canExport = computed(() => !!props.source.export && manifest.value?.state === "complete" && manifest.value.pageCount > 0 && !stale.value);
const status = computed(() => {
  if (loading.value) return messages.value.documentLoading;
  const value = manifest.value; if (!value) return "";
  const text = value.state === "building" ? messages.value.documentBuilding : value.state === "failed" ? messages.value.documentFailed : messages.value.documentComplete;
  return text.replace("{pages}", String(value.pageCount));
});
function reportError(cause: unknown): void { error.value = cause instanceof Error ? cause.message : String(cause); emit("error", error.value); }
function cancel(): void { sequence++; loadController?.abort(); exportController?.abort(); loadController = undefined; exportController = undefined; loading.value = false; exporting.value = false; }
function navigate(event: KeyboardEvent): void {
  if (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
  if (event.ctrlKey || event.metaKey || event.altKey || loading.value || exporting.value || !manifest.value?.pageCount) return;
  const targets: Record<string, number> = { PageDown: currentPage.value + 1, PageUp: currentPage.value - 1, Home: 1, End: manifest.value.pageCount };
  const target = targets[event.key]; if (target === undefined) return;
  event.preventDefault(); event.stopPropagation(); void gotoPage(Math.max(1, Math.min(target, manifest.value.pageCount)));
}
async function gotoPage(page: number): Promise<void> {
  if (!Number.isSafeInteger(page) || page < 1 || manifest.value && page > manifest.value.pageCount) throw new MachReportError("param", messages.value.pageJumpInvalid ?? "请输入有效页码");
  loadController?.abort(); const controller = new AbortController(), seq = ++sequence;
  loadController = controller; loading.value = true; error.value = "";
  try {
    const value = await reader.load(page - 1, controller.signal);
    assertOutputActive(controller.signal); if (seq !== sequence) return;
    manifest.value = value.manifest; currentPage.value = page; stale.value = false;
    plan.value = { ...value.manifest.plan, pages: value.page ? [value.page] : [] };
    reportKey.value = JSON.stringify([value.manifest.scope, value.manifest.id, value.manifest.version, page]);
    emit("loaded", cloneReportSnapshot(value.manifest));
  } catch (cause) { if (!controller.signal.aborted && seq === sequence) { stale.value = true; reportError(cause); } }
  finally { if (seq === sequence) { loading.value = false; loadController = undefined; } }
}
async function reload(): Promise<void> { cancel(); reader.reset(); stale.value = !!plan.value; manifest.value = undefined; await gotoPage(1); }
async function exportDocument(format: "pdf" | "xlsx"): Promise<ReportRuntimeExportResult> {
  const source = props.source, pinned = manifest.value;
  if (!source.export || !pinned || !canExport.value || loading.value || exporting.value) throw new MachReportError("export", messages.value.documentFullExport);
  const controller = new AbortController(); exportController = controller; exporting.value = true;
  try {
    const result = await waitForOutput(source.export({ version: pinned.version, format, signal: controller.signal }), controller.signal);
    assertOutputActive(controller.signal); assertReportExportResult(result, format);
    if (source !== props.source || manifest.value?.version !== pinned.version || result.stats.pages !== pinned.pageCount) throw new MachReportError("export", "完整文档导出的版本或页数不一致");
    emit("exported", result); return result;
  } finally { if (exportController === controller) { exporting.value = false; exportController = undefined; } }
}
async function download(format: string): Promise<void> {
  if (format !== "pdf" && format !== "xlsx") return;
  const generation = sequence, source = props.source;
  try {
    const result = await exportDocument(format);
    const blob = new Blob([Uint8Array.from(result.bytes).buffer], { type: result.contentType });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `report.${format}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (cause) {
    if (generation !== sequence || source !== props.source || cause && typeof cause === "object" && "name" in cause && cause.name === "AbortError") return;
    reportError(cause);
  }
}
watch(() => props.source, () => { cancel(); reader.dispose(); reader = createDocumentWindowReader(props.source); plan.value = undefined; manifest.value = undefined; if (mounted) void gotoPage(1); });
onMounted(() => { mounted = true; void gotoPage(1); });
onUnmounted(() => { mounted = false; cancel(); reader.dispose(); });
defineExpose({ reload, gotoPage, cancel, export: exportDocument, state: computed(() => cloneReportSnapshot({ manifest: manifest.value ?? null, currentPage: currentPage.value, loading: loading.value, exporting: exporting.value, error: error.value })) });
</script>
<template>
  <section class="mrp-document" :style="{ ...themeToCssVars(resolved.theme), height }" :aria-busy="loading || exporting" @keydown.capture="navigate">
    <div class="mrp-document-status" role="status"><span>{{ status }}</span><button v-if="loading || exporting" type="button" @click="cancel">{{ messages.documentCancel }}</button><button v-else type="button" @click="reload">{{ messages.documentRefresh }}</button></div>
    <div v-if="error" class="mrp-document-error" role="alert">{{ error }}</div>
    <ReportPreview v-if="plan" :report-id="reportKey" :fetcher="fetcher" height="100%" :messages="messages" :preset="preset" :editable="false" :excel-import="false" :prefill="false" :data-comparison="false" :show-params="false" :show-export="canExport" :show-print="false" :show-pdf-window="false" :show-settings="false" :toolbar="{ search: false, thumbnails: false, exportFormats: [] }" :interaction="{ navigation: false, calculations: false }" @error="reportError">
      <template #export><ReportExportMenu :messages="messages" :formats="['pdf', 'xlsx']" :busy="loading || exporting" @export="download" /></template>
      <template #pagination><ReportPagination :page-count="manifest?.pageCount ?? 0" :current-page="currentPage" :messages="messages" :busy="loading || exporting" @goto="gotoPage" /></template>
    </ReportPreview>
  </section>
</template>
<style scoped>
.mrp-document{box-sizing:border-box;display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--mrp-shell-bg);color:var(--mrp-toolbar-fg);font-family:Arial,sans-serif;border:1px solid var(--mrp-toolbar-border);border-radius:10px;overflow:hidden}.mrp-document :deep(.mach-report-preview){flex:1;min-height:0;border:0}.mrp-document-status{display:flex;align-items:center;gap:12px;min-height:34px;padding:0 14px;background:var(--mrp-toolbar-bg);border-bottom:1px solid var(--mrp-toolbar-border);font-size:12px}.mrp-document-status span{flex:1}.mrp-document-status button{padding:3px 8px;border:1px solid var(--mrp-btn-border);border-radius:5px;background:transparent;color:var(--mrp-btn-fg);font:inherit;cursor:pointer}.mrp-document-status button:hover{background:var(--mrp-btn-hover-bg);color:var(--mrp-btn-hover-fg)}.mrp-document-status button:focus-visible{outline:2px solid var(--mrp-btn-active-bg);outline-offset:2px}.mrp-document-error{padding:8px 14px;color:var(--mrp-error-fg,#b91c1c);background:var(--mrp-error-bg,#fef2f2);font-size:12px;overflow-wrap:anywhere}
</style>
