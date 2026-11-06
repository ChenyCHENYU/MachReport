// @vitest-environment node
import { expect, it } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { defineMachReportConfig, machReportPlugin } from "../../vue/index";
import { useDesignerTheme } from "../useDesignerTheme";

it("resolves independent SSR themes without browser globals or shared mutable theme state", async () => {
  expect(typeof window).toBe("undefined"); expect(typeof document).toBe("undefined");
  const Probe = defineComponent({ setup() { const theme = useDesignerTheme(); return () => h("section", { style: theme.value }, [h("input")]); } });
  async function render(color: string, scheme: "light" | "dark") {
    const app = createSSRApp(Probe);
    app.use(machReportPlugin, { globalComponent: false, config: defineMachReportConfig({ defaults: { theme: { shellBg: color, colorScheme: scheme } } }) });
    return renderToString(app);
  }
  const [dark, light] = await Promise.all([render("#171717", "dark"), render("#fafafa", "light")]);
  expect(dark).toContain("--mrp-shell-bg:#171717"); expect(dark).toContain("--mrp-color-scheme:dark");
  expect(light).toContain("--mrp-shell-bg:#fafafa"); expect(light).toContain("--mrp-color-scheme:light");
});
