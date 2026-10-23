<script setup lang="ts">
import { computed, ref } from "vue";
import type { ReportTemplateDocument } from "@agile-team/mach-report";
import {
  collectTemplateOutline,
  inspectTemplateFieldUsage,
  type TemplateOutlineLocation,
} from "../source/template-outline";
import {
  TEMPLATE_PRODUCT_MESSAGES,
  type TemplateProductMessages,
} from "./product-messages";
const props = defineProps<{
  document: ReportTemplateDocument;
  selection?: { pageIndex: number; componentIndex: number };
  messages?: Partial<TemplateProductMessages>;
}>();
const emit = defineEmits<{
  (event: "locate", location: TemplateOutlineLocation): void;
}>();
const m = computed(() => ({ ...TEMPLATE_PRODUCT_MESSAGES, ...props.messages }));
const query = ref(""),
  limit = ref(100),
  usage = ref<{ dataset: string; field: string }>();
const outline = computed(() => collectTemplateOutline(props.document.template));
const filtered = computed(() => {
  const terms = query.value
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return outline.value.filter((entry) =>
    terms.every((term) =>
      `${entry.title} ${entry.dataset ?? ""} ${entry.path}`
        .toLocaleLowerCase()
        .includes(term),
    ),
  );
});
const references = computed(() =>
  usage.value
    ? inspectTemplateFieldUsage(
        props.document.template,
        usage.value.dataset,
        usage.value.field,
      )
    : [],
);
function choose(location: (typeof outline.value)[number]): void {
  emit("locate", location);
  if (location.dataset && location.field)
    usage.value = { dataset: location.dataset, field: location.field };
}
</script>
<template>
  <section class="mr-product-panel mr-outline" :aria-label="m.outline">
    <header>
      <div>
        <strong>{{ m.outline }}</strong><small>{{ filtered.length }} {{ m.count }}</small>
      </div>
      <label><span class="sr-only">{{ m.search }}</span><input
          v-model="query"
          type="search"
          :placeholder="m.search"
          @input="limit = 100"
      /></label>
    </header>
    <div class="mr-outline-layout">
      <ol class="mr-outline-tree">
        <li
          v-for="entry in filtered.slice(0, limit)"
          :key="entry.path"
          :style="{ '--depth': entry.depth }"
        >
          <button type="button" @click="choose(entry)">
            <span class="mr-outline-kind">{{ m[entry.kind] }}</span><strong>{{ entry.title }}</strong><small v-if="entry.dataset">{{ entry.dataset }}</small>
          </button>
        </li>
        <li v-if="!filtered.length" class="mr-product-note">
          {{ m.noMatches }}
        </li>
      </ol>
      <aside v-if="usage">
        <h3>{{ m.usages }} · {{ usage.field }}</h3>
        <button
          v-for="reference in references.slice(0, 100)"
          :key="reference.path"
          type="button"
          class="mr-outline-reference"
          @click="emit('locate', reference)"
        >
          <span>{{
              reference.pageIndex === undefined
                ? m.binding
                : `${m.page} ${reference.pageIndex + 1}`
            }}
            ·
            {{
              m[reference.kind === "display" ? "field" : reference.kind]
            }}</span><code>{{ reference.path }}</code>
        </button>
      </aside>
    </div>
    <button
      v-if="filtered.length > limit"
      type="button"
      class="mr-product-more"
      @click="limit += 100"
    >
      {{ m.more }} · {{ filtered.length - limit }}
    </button>
  </section>
</template>
<style scoped src="./template-product.css"></style>
