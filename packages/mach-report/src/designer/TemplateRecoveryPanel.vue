<script setup lang="ts">
import { computed } from "vue";
import type { useTemplateDraftRecovery } from "./useTemplateDraftRecovery";
import type { useTemplateConflict } from "./useTemplateConflict";
import {
  TEMPLATE_RECOVERY_MESSAGES,
  type TemplateRecoveryMessages,
} from "./recovery-messages";

const props = defineProps<{
  recovery: ReturnType<typeof useTemplateDraftRecovery>;
  conflict: ReturnType<typeof useTemplateConflict>;
  readonly?: boolean;
  messages?: Partial<TemplateRecoveryMessages>;
  canLoad?: boolean;
  canCopy?: boolean;
}>();
const m = computed(() => ({ ...TEMPLATE_RECOVERY_MESSAGES, ...props.messages }));
</script>

<template>
  <div v-if="recovery.available.value" class="mr-recovery-banner" role="status">
    <div>
      <strong>{{ m.available }}</strong>
      <small>
        {{ recovery.available.value.savedAt }} · {{ m.revision }}
        {{ recovery.available.value.baseline.revision || m.unknown }}
      </small>
      <p v-if="recovery.stale.value">{{ m.stale }}</p>
    </div>
    <div class="mr-recovery-actions">
      <button type="button" :disabled="readonly" @click="recovery.restore">
        {{ m.restore }}
      </button>
      <button type="button" @click="recovery.discard">{{ m.discard }}</button>
    </div>
  </div>

  <div v-if="recovery.error.value" class="mr-recovery-banner is-error" role="alert">
    <span>{{ m.storageError }}：{{ recovery.error.value }}</span>
    <div class="mr-recovery-actions">
      <button type="button" @click="recovery.discard">{{ m.discard }}</button>
    </div>
  </div>
  <small
    v-else-if="recovery.status.value !== 'idle'"
    class="mr-recovery-status"
    role="status"
  >
    {{ recovery.status.value === 'saving' ? m.saving : m.autosaved }}
  </small>

  <details v-if="conflict.active.value" class="mr-recovery-conflict" open>
    <summary>{{ m.conflict }}</summary>
    <p>{{ m.conflictHint }}</p>
    <div class="mr-recovery-columns">
      <section
        v-for="(diff, index) in [conflict.localChanges.value, conflict.remoteChanges.value]"
        :key="index"
      >
        <h4>
          {{ index ? m.remote : m.local }}
          <small>{{ diff?.totalChanges ?? '—' }} {{ m.changes }}</small>
        </h4>
        <table v-if="diff?.changes.length">
          <thead>
            <tr><th>{{ m.path }}</th><th>{{ m.before }}</th><th>{{ m.after }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="change in diff.changes" :key="`${change.kind}:${change.path}`">
              <th>{{ change.path }}</th>
              <td>{{ change.before ?? '—' }}</td>
              <td>{{ change.after ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>{{ m.empty }}</p>
      </section>
    </div>
    <p v-if="conflict.error.value" role="alert">{{ conflict.error.value }}</p>
    <p v-if="conflict.copied.value" role="status">{{ m.copied }}</p>
    <div class="mr-recovery-actions">
      <button
        v-if="canLoad"
        type="button"
        :disabled="conflict.busy.value"
        @click="conflict.load"
      >
        {{ m.loadLatest }}
      </button>
      <button
        v-if="canCopy"
        type="button"
        :disabled="readonly || conflict.busy.value"
        @click="conflict.keepCopy"
      >
        {{ m.keepCopy }}
      </button>
      <button
        v-if="conflict.latest.value"
        type="button"
        :disabled="readonly || conflict.busy.value"
        @click="conflict.adoptLatest"
      >
        {{ m.adopt }}
      </button>
      <button
        v-if="conflict.latest.value"
        type="button"
        :disabled="readonly || conflict.busy.value"
        @click="conflict.toggleRebase"
      >
        {{ m.rebase }}
      </button>
    </div>
    <div v-if="conflict.confirmRebase.value" class="mr-recovery-confirm">
      <p>{{ m.confirmHint }}</p>
      <button
        type="button"
        :disabled="readonly || conflict.busy.value"
        @click="conflict.rebase"
      >
        {{ m.confirm }}
      </button>
    </div>
  </details>
</template>

<style scoped>
.mr-recovery-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: #eff6ff;
  border-bottom: 1px solid #dbeafe;
  color: #1e3a5f;
  font-size: 12px;
}
.mr-recovery-banner small {
  display: block;
  margin-top: 3px;
  color: #64748b;
}
.mr-recovery-banner p { margin: 6px 0 0; }
.is-error { background: #fff7ed; color: #9a3412; }
.mr-recovery-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.mr-recovery-actions button,
.mr-recovery-confirm button {
  border: 1px solid #cbd5e1;
  background: white;
  border-radius: 6px;
  padding: 7px 11px;
  font: inherit;
  color: #1e40af;
  cursor: pointer;
}
.mr-recovery-actions button:disabled { opacity: .45; cursor: default; }
.mr-recovery-status {
  display: block;
  padding: 4px 16px;
  color: #64748b;
  font-size: 11px;
}
.mr-recovery-conflict {
  padding: 12px 16px;
  border-bottom: 1px solid #fed7aa;
  background: #fffaf5;
  font-size: 12px;
  color: #475569;
}
.mr-recovery-conflict summary { cursor: pointer; font-weight: 600; color: #92400e; }
.mr-recovery-conflict p { margin: 8px 0; }
.mr-recovery-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 12px 0;
}
.mr-recovery-columns section {
  min-width: 0;
  max-height: 240px;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  background: #fff;
}
.mr-recovery-columns h4 { margin: 0; padding: 9px 12px; border-bottom: 1px solid #e2e8f0; }
.mr-recovery-columns h4 small { float: right; color: #64748b; }
.mr-recovery-columns table {
  border-collapse: collapse;
  width: 100%;
  font-size: 11px;
  table-layout: fixed;
}
.mr-recovery-columns td,
.mr-recovery-columns th {
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
  padding: 6px 8px;
  overflow-wrap: anywhere;
  vertical-align: top;
}
.mr-recovery-columns tbody th { font-weight: 400; }
.mr-recovery-confirm {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid #fdba74;
  border-radius: 7px;
}
.mr-recovery-actions button:focus-visible,
.mr-recovery-conflict summary:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
@media (max-width: 700px) {
  .mr-recovery-banner { align-items: flex-start; flex-direction: column; }
  .mr-recovery-columns { grid-template-columns: 1fr; }
}
</style>
