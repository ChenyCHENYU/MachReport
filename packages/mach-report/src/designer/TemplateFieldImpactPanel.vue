<script setup lang="ts">
import { computed } from "vue";
import type { TemplateFieldUsage } from "../source/template-outline";
import {
  TEMPLATE_PRODUCT_MESSAGES,
  type TemplateProductMessages,
} from "./product-messages";
const props = defineProps<{
  change?: { before: string; after: string; references: TemplateFieldUsage[] };
  messages?: Partial<TemplateProductMessages>;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  (event: "confirm"): void;
  (event: "cancel"): void;
  (event: "locate", reference: TemplateFieldUsage): void;
}>();
const m = computed(() => ({ ...TEMPLATE_PRODUCT_MESSAGES, ...props.messages }));
</script>
<template>
  <section
    v-if="change"
    class="mr-impact"
    role="alertdialog"
    :aria-label="m.rename"
  >
    <strong>{{ m.rename }}</strong><code>{{ change.before }} → {{ change.after }}</code>
    <p>{{ m.renameHint }}</p>
    <ol>
      <li
        v-for="reference in change.references.slice(0, 100)"
        :key="reference.path"
      >
        <button type="button" @click="emit('locate', reference)">
          {{ m.locate }} · {{ reference.path }}
        </button>
      </li>
    </ol>
    <footer>
      <button type="button" :disabled="disabled" @click="emit('cancel')">
        {{ m.cancel }}
</button><button type="button" :disabled="disabled" @click="emit('confirm')">
        {{ m.continue }}
      </button>
    </footer>
  </section>
</template>
<style scoped src="./template-product.css"></style>
