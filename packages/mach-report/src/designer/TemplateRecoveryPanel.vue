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
  background: var(--mrp-btn-hover-bg, #eff6ff);
  border-bottom: 1px solid var(--mrp-btn-border, #dbeafe);
  color: var(--mrp-toolbar-fg, #1e3a5f);
  font-size: 12px;
}
.mr-recovery-banner small {
  display: block;
  margin-top: 3px;
  color: var(--mrp-btn-fg, #64748b);
}
.mr-recovery-banner p { margin: 6px 0 0; }
.is-error {
  background: var(--mrp-toolbar-bg, #fff);
  background: color-mix(in srgb, var(--mrp-error-fg, #b91c1c) 7%, var(--mrp-toolbar-bg, #fff));
  color: var(--mrp-error-fg, #9a3412);
}
.mr-recovery-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.mr-recovery-actions button,
.mr-recovery-confirm button {
  border: 1px solid var(--mrp-toolbar-border, #cbd5e1);
  background: var(--mrp-toolbar-bg, white);
  border-radius: 6px;
  padding: 7px 11px;
  font: inherit;
  color: var(--mrp-btn-hover-fg, #1e40af);
  cursor: pointer;
}
.mr-recovery-actions button:disabled { opacity: .45; cursor: default; }
.mr-recovery-conflict {
  padding: 12px 16px;
  border-bottom: 1px solid var(--mrp-toolbar-border, #e2e8f0);
  border-bottom: 1px solid color-mix(in srgb, var(--mrp-warning-fg, #92400e) 25%, var(--mrp-toolbar-bg, #fff));
  background: var(--mrp-toolbar-bg, #fff);
  background: color-mix(in srgb, var(--mrp-warning-fg, #92400e) 7%, var(--mrp-toolbar-bg, #fff));
  font-size: 12px;
  color: var(--mrp-toolbar-fg, #475569);
}
.mr-recovery-conflict summary { cursor: pointer; font-weight: 600; color: var(--mrp-warning-fg, #92400e); }
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
  border: 1px solid var(--mrp-toolbar-border, #e2e8f0);
  border-radius: 7px;
  background: var(--mrp-toolbar-bg, #fff);
}
.mr-recovery-columns h4 { margin: 0; padding: 9px 12px; border-bottom: 1px solid var(--mrp-toolbar-border, #e2e8f0); }
.mr-recovery-columns h4 small { float: right; color: var(--mrp-btn-fg, #64748b); }
.mr-recovery-columns table {
  border-collapse: collapse;
  width: 100%;
  font-size: 11px;
  table-layout: fixed;
}
.mr-recovery-columns td,
.mr-recovery-columns th {
  text-align: left;
  border-bottom: 1px solid var(--mrp-toolbar-border, #f1f5f9);
  padding: 6px 8px;
  overflow-wrap: anywhere;
  vertical-align: top;
}
.mr-recovery-columns tbody th { font-weight: 400; }
.mr-recovery-confirm {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--mrp-toolbar-border, #e2e8f0);
  border: 1px solid color-mix(in srgb, var(--mrp-warning-fg, #92400e) 25%, var(--mrp-toolbar-bg, #fff));
  border-radius: 7px;
}
.mr-recovery-actions button:focus-visible,
.mr-recovery-conflict summary:focus-visible {
  outline: 2px solid var(--mrp-btn-active-bg, #2563eb);
  outline-offset: 2px;
}
@media (max-width: 700px) {
  .mr-recovery-banner { align-items: flex-start; flex-direction: column; }
  .mr-recovery-columns { grid-template-columns: 1fr; }
}
</style>
