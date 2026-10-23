import { computed, ref } from "vue";
/** Small tool forms have an explicit accepted baseline, independent of the template history. */
export function useLocalDraft(read: () => unknown) {
  const baseline = ref("");
  const snapshot = () => JSON.stringify(read());
  const pending = computed(() => baseline.value !== "" && snapshot() !== baseline.value);
  function accept(): void { baseline.value = snapshot(); }
  accept();
  return { pending, snapshot, accept, baseline };
}
