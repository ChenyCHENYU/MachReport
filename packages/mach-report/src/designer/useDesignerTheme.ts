import { computed, type ComputedRef, type CSSProperties } from "vue";
import {
  resolveConfig,
  themeToCssVars,
  useMachReportConfig,
  type MachReportTheme,
} from "@agile-team/mach-report/vue";

/** Resolve the same application/route theme as the embedded preview. */
export function useDesignerTheme(override?: () => Partial<MachReportTheme> | undefined): ComputedRef<CSSProperties> {
  const config = useMachReportConfig();
  return computed(() => ({
    ...themeToCssVars({
      ...resolveConfig(config.value).theme,
      ...override?.(),
    }),
    colorScheme: "var(--mrp-color-scheme, light)",
  }));
}
