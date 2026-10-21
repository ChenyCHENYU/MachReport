<script setup lang="ts">
import type { ReportTemplateDocument, ReportTemplateCatalogOpenContext } from "@agile-team/mach-report";
import { useTemplateLibrary, type TemplateLibraryOptions } from "./useTemplateLibrary";
const props = defineProps<TemplateLibraryOptions>();
const emit = defineEmits<{ (event: "open", document: ReportTemplateDocument, context?: ReportTemplateCatalogOpenContext): void }>();
const { m, cursors, query, category, entries, categories, next, loading, busy, error, copying, newId, newName, search, load, beginCopy, cancelCopy, retry, retryLabel, loadingTarget } = useTemplateLibrary(props, (document, context) => emit("open", document, context));
</script>
<template>
  <section class="mr-library" :aria-label="m.title" :aria-busy="loading || busy">
    <header><div><h2>{{ m.title }}</h2><p>{{ m.subtitle }}</p></div><button type="button" :disabled="loading || busy" @click="search()">{{ m.refresh }}</button></header>
    <div class="mr-library-search"><input v-model="query" type="search" :placeholder="m.search" :aria-label="m.search" @keydown.enter="search()"><select v-model="category" :aria-label="m.all"><option value="">{{ m.all }}</option><option v-for="item in categories" :key="item.id" :value="item.id">{{ item.label }}{{ item.count === undefined ? '' : ` (${item.count})` }}</option></select></div>
    <div v-if="loadingTarget" class="mr-library-progress" role="status">{{ loadingTarget }}</div>
    <div v-if="error" role="alert" class="mr-library-error">{{ error }} <button type="button" :disabled="loading || busy" @click="retry()">{{ retryLabel }}</button></div>
    <form v-if="copying" class="mr-library-copy" @submit.prevent="load(copying, true)"><strong>{{ m.copyTitle }} · {{ copying.name }}</strong><label>{{ m.newId }}<input v-model="newId" required maxlength="256" :disabled="busy"></label><label>{{ m.newName }}<input v-model="newName" required maxlength="256" :disabled="busy"></label><div><button type="button" :disabled="busy" @click="cancelCopy()">{{ m.cancel }}</button><button type="submit" :disabled="busy || !newId.trim() || !newName.trim()">{{ busy ? m.loading : m.create }}</button></div></form>
    <ul v-if="entries.length"><li v-for="entry in entries" :key="entry.id"><div class="mr-library-info"><button class="mr-library-name" :title="entry.name" type="button" :disabled="busy" @click="load(entry)">{{ entry.name }}</button><small :title="entry.id">{{ entry.id }}<span v-if="entry.revision"> · {{ m.revision }} {{ entry.revision }}</span></small><span v-if="entry.draftRevision || entry.publishedRevision" class="mr-library-state" :class="{ 'mr-library-state--draft': entry.draftRevision }">{{ entry.draftRevision ? (entry.publishedRevision ? m.draftPending : m.draft) : m.published }}</span><p v-if="entry.description">{{ entry.description }}</p><div v-if="entry.tags?.length" class="mr-library-tags"><span v-for="tag in entry.tags" :key="tag" :title="tag">{{ tag }}</span></div></div><div class="mr-library-actions"><button v-if="create" type="button" :disabled="busy" @click="beginCopy(entry)">{{ m.copy }}</button><button v-if="entry.publishedRevision" type="button" :disabled="busy" @click="load(entry, false, 'published')">{{ m.viewPublished }}</button><button type="button" :disabled="busy" @click="load(entry)">{{ entry.draftRevision ? m.continueDraft : m.open }}</button></div></li></ul>
    <div v-else class="mr-library-empty" role="status"><strong>{{ loading ? m.loading : m.empty }}</strong><p v-if="!loading">{{ m.emptyHint }}</p></div>
    <footer><span>{{ cursors.length }} {{ m.page }} · {{ entries.length }} {{ m.count }}</span><div><button v-if="cursors.length > 1" type="button" :disabled="loading || busy" @click="search(false, true)">{{ m.previous }}</button><button v-if="next" type="button" :disabled="loading || busy" @click="search(true)">{{ loading ? m.loading : m.loadMore }}</button></div></footer>
  </section>
</template>

<style scoped src="./template-library.css"></style>
