<script setup lang="ts">
import { ReportPreview } from "@agile-team/mach-report/vue";
import type { ReportTemplateDocument } from "@agile-team/mach-report";
import ReportTemplateEditor from "./ReportTemplateEditor.vue";
import { useLabelStudio, type LabelStudioOptions } from "./useLabelStudio";
const props = defineProps<LabelStudioOptions>();
const emit = defineEmits<{ (event: "update:modelValue", document: ReportTemplateDocument): void }>();
const studio = useLabelStudio(props, document => emit("update:modelValue", document));
const { m, notice, title, document, mode, record, recordIndex, sheet, busy, editor, rows, datasets, schemas, bindings, paper, labelCount, fetcher } = studio;
defineExpose({ guardChanges: studio.guardChanges, prepare: studio.prepare, get busy() { return busy.value; } });
</script>
<template>
  <section class="mr-label-studio" :class="{ 'is-design': mode === 'design' }" :aria-label="title">
    <aside class="mr-label-context">
      <div class="mr-label-identity"><span aria-hidden="true">▦</span><strong>{{ title }}</strong><small>{{ m.session }}</small></div>
      <div class="mr-label-spec"><strong>{{ paper?.widthMm }} <i>×</i> {{ paper?.heightMm }}</strong><span>mm · {{ document.template.pages.length }} {{ m.faces }}</span><small>QR · CODE 128</small></div>
      <label class="mr-label-record">{{ m.records }}<select v-model="record" :disabled="busy || mode === 'design' || !props.rows.length"><option value="all">{{ m.all }} · {{ props.rows.length }}</option><option value="single">{{ m.single }}</option></select></label>
      <label v-if="record === 'single'" class="mr-label-record-index">{{ m.record }}<input v-model.number="recordIndex" type="number" min="1" :max="props.rows.length" :aria-label="m.record" :disabled="busy || mode === 'design'" /> / {{ props.rows.length }}</label>
      <p class="mr-label-count"><strong>{{ rows.length }}</strong> {{ m.count }} <span>→</span> <template v-if="labelCount !== undefined"><strong>{{ labelCount }}</strong> {{ m.labels }}</template><template v-else>{{ m.invalidCopies }}</template></p>
      <details class="mr-label-help"><summary>{{ m.guide }}</summary><p>{{ m.help }}</p><p>{{ m.printHint }}</p></details>
    </aside>
    <div class="mr-label-main">
      <header class="mr-label-bar"><nav :aria-label="title"><button type="button" :aria-pressed="mode === 'preview'" :disabled="busy" @click="studio.navigate('preview')">{{ m.preview }}</button><button type="button" :aria-pressed="mode === 'design'" :disabled="busy" @click="studio.navigate('design')">{{ m.design }}</button></nav><span>{{ m.flow }}</span></header>
      <p v-if="notice" class="mr-label-notice" role="status">{{ notice }}</p>
      <ReportPreview v-if="mode === 'preview'" report-id="labels" :fetcher="fetcher" :show-params="false" height="100%" :toolbar="{ exportFormats: ['pdf','png','html'], editing: false, excelImport: false }" :messages="{ title, empty: m.empty }">
        <template #settings><label class="mr-label-imposition"><input v-model="sheet" type="checkbox">{{ m.sheet }}<small>{{ m.sheetHint }}</small></label></template>
      </ReportPreview>
      <ReportTemplateEditor v-else ref="editor" :model-value="document" :datasets="datasets" :data-schemas="schemas" :binding-datasets="bindings" :save="studio.save" :before-discard="beforeDiscard" :preview="preview" @update:model-value="studio.update" />
    </div>
  </section>
</template>
<style src="./label-studio.css"></style>
