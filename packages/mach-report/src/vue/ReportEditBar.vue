<script setup lang="ts">
import type { ReportCellEdit, ReportEditConflict } from "@agile-team/mach-report";
import type { MachReportMessages } from "./config";
defineProps<{ differences: readonly ReportCellEdit[]; conflicts: readonly ReportEditConflict[]; messages: MachReportMessages; saving: boolean; canUndo: boolean; canRedo: boolean; busy?: boolean; persisted?: boolean }>();
defineEmits<{ (e: "undo"): void; (e: "redo"): void; (e: "restore"): void; (e: "locate", edit: ReportCellEdit): void }>();
function label(edit: ReportCellEdit): string {
  return edit.source ? `${edit.source.rowKey} · ${edit.source.field}` : `${edit.address.pageIndex + 1} / ${edit.address.rowIndex + 1}:${edit.address.columnIndex + 1}`;
}
</script>
<template>
  <div class="mrp-edit-bar">
    <button type="button" :disabled="busy || saving || !canUndo" @click="$emit('undo')">{{ messages.undo }}</button>
    <button type="button" :disabled="busy || saving || !canRedo" @click="$emit('redo')">{{ messages.redo }}</button>
    <details class="mrp-changes">
      <summary>{{ messages.changes }} · {{ messages.changesCount?.replace('{count}', String(differences.length)) }}</summary>
      <section :aria-label="messages.changes">
        <p v-if="!differences.length">{{ messages.changesEmpty }}</p>
        <ol v-else>
          <li v-for="(edit, index) in differences" :key="index"><button type="button" @click="$emit('locate', edit)">{{ label(edit) }}</button><span><s :title="messages.changesBefore">{{ edit.previousText || '∅' }}</s> → <strong :title="messages.changesAfter">{{ edit.text || '∅' }}</strong></span></li>
        </ol>
      </section>
    </details>
    <button type="button" :disabled="busy || saving || !differences.length" @click="$emit('restore')">{{ messages.restoreChanges }}</button>
    <span v-if="saving" role="status">{{ messages.saving }}</span>
    <span v-else-if="differences.length && !conflicts.length" role="status">{{ persisted ? messages.editSaved : messages.editingLocal }}</span>
    <details v-if="conflicts.length" class="mrp-conflicts" open><summary>{{ messages.conflicts }} · {{ conflicts.length }}</summary><ul><li v-for="(conflict, index) in conflicts" :key="index">{{ conflict.message }}</li></ul></details>
  </div>
</template>
<style scoped>
.mrp-edit-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 12px;border-bottom:1px solid var(--mrp-toolbar-border);font-size:12px;color:var(--mrp-toolbar-fg);background:var(--mrp-toolbar-bg)}
button{font:inherit;background:transparent;color:inherit;border:1px solid var(--mrp-btn-border);border-radius:4px;padding:3px 8px;cursor:pointer}button:disabled{opacity:.45;cursor:default}summary{cursor:pointer;padding:3px 5px}.mrp-changes{position:relative}.mrp-changes section{position:absolute;z-index:15;top:28px;left:0;max-height:260px;overflow:auto;min-width:300px;max-width:min(480px,80vw);border:1px solid var(--mrp-btn-border);background:var(--mrp-toolbar-bg);padding:10px;box-shadow:0 5px 20px #0003;border-radius:6px}.mrp-changes ol{margin:0;padding-left:22px}.mrp-changes li{padding:5px 0}.mrp-changes li span{display:block;margin-top:5px;overflow-wrap:anywhere}s{opacity:.65}.mrp-conflicts{color:#b9382a;width:100%}
</style>
