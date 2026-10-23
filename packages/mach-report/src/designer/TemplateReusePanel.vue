<script setup lang="ts">
import {
  useTemplateReuse,
  type TemplateReuseOptions,
} from "./useTemplateReuse";
import type { CanvasSelection } from "./canvas-commands";
const props = defineProps<TemplateReuseOptions>();
const emit = defineEmits<{
  (event: "select", location: CanvasSelection): void;
}>();
const {
  m,
  name,
  fragmentId,
  fragments,
  fragment,
  bindings,
  required,
  active,
  instance,
  canUpdate,
  error,
  styles,
  styleId,
  style,
  clipboard,
  capture,
  insert,
  apply,
  copyStyle,
} = useTemplateReuse(props, (location) => emit("select", location));
</script>
<template>
  <section class="mr-product-panel" :aria-label="m.reuse">
    <header>
      <strong>{{ m.reuse }}</strong><small>{{ m.preserve }}</small>
    </header>
    <p v-if="error" role="alert" class="mr-reuse-error">{{ error }}</p>
    <div class="mr-reuse-layout">
      <section>
        <h3>{{ m.fragments }}</h3>
        <p v-if="!fragments.length" class="mr-product-note">
          {{ m.noFragments }}
        </p>
        <template v-else>
          <label>{{ m.fragments
            }}<select v-model="fragmentId">
              <option v-for="item in fragments" :key="item.id" :value="item.id">
                {{ item.name }} · {{ item.revision }}
              </option>
            </select></label>
          <p class="mr-product-note">
            {{ m.revision }} {{ fragment?.revision
            }}<span v-if="instance">
              · {{ m.instance }} {{ instance.revision }}</span>
          </p>
          <div v-if="required.length" class="mr-reuse-bindings">
            <h3>{{ m.bindings }}</h3>
            <template v-for="group in required" :key="group.dataset">
<p v-if="'error' in group" role="alert">{{ group.error }}</p>
              <template v-else>
<label>{{ m.dataset }} · {{ group.dataset
                  }}<input
                    v-model="bindings.datasets![group.dataset]"
                    :disabled="disabled"
/></label><label v-for="field in group.fields" :key="field">{{ field
                  }}<input
                    v-model="bindings.fields![group.dataset]![field]"
                    :aria-label="`${m.target} ${field}`"
                    :disabled="disabled"
/></label>
</template>
</template>
          </div>
          <div class="mr-reuse-actions">
            <button
              type="button"
              class="mr-reuse-primary"
              :disabled="disabled || !fragment"
              @click="insert()"
            >
              {{ m.insert }}
</button><button
              v-if="canUpdate"
              type="button"
              :disabled="disabled"
              @click="insert(true)"
            >
              {{ m.update }}
            </button>
          </div>
          <p v-if="canUpdate" class="mr-product-note">{{ m.newRevision }}</p>
        </template>
        <div class="mr-reuse-bindings">
          <label>{{ m.fragmentName
            }}<input v-model="name" :disabled="disabled || !active" /></label><button
            type="button"
            :disabled="disabled || !active || !name.trim()"
            @click="capture"
          >
            {{ m.capture }}
          </button>
        </div>
      </section>
      <section>
        <h3>{{ m.styles }}</h3>
        <p class="mr-product-note">{{ m.noStyles }}</p>
        <label>{{ m.role
          }}<select v-model="styleId">
            <option v-for="item in styles" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select></label>
        <div
          class="mr-reuse-swatch"
          :style="{
            color: style.style.color,
            backgroundColor: style.style.backgroundColor,
            fontSize: `${style.style.fontSize ?? 10}pt`,
            fontWeight: style.style.bold ? 600 : 400,
            textAlign: style.style.align,
          }"
        >
          {{ style.name }} · Aa 0123
        </div>
        <p v-if="!active" class="mr-product-note">{{ m.select }}</p>
        <div class="mr-reuse-actions">
          <button
            type="button"
            class="mr-reuse-primary"
            :disabled="disabled || !active"
            @click="apply()"
          >
            {{ m.apply }}
</button><button type="button" :disabled="!active" @click="copyStyle">
            {{ m.copy }}
</button><button
            type="button"
            :disabled="disabled || !active || !clipboard"
            @click="
              apply({ id: 'clipboard', name: m.paste, style: clipboard! })
            "
          >
            {{ m.paste }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
<style scoped src="./template-product.css"></style>
