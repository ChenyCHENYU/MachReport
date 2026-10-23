import { createApp } from "vue";
import { describe, expect, it, vi } from "vitest";
import ParametersDemo from "../ParametersDemo.vue";

describe("remote parameter example integration", () => {
  it("registers an actual source and exposes dependency-aware fields", async () => {
    const root = document.createElement("div"), app = createApp(ParametersDemo);
    document.body.append(root); app.mount(root);
    try {
      await vi.waitFor(() => expect(root.querySelectorAll('input[role="combobox"]')).toHaveLength(2));
      const fields = root.querySelectorAll<HTMLInputElement>('input[role="combobox"]');
      expect(fields[0]!.disabled).toBe(false); expect(fields[1]!.disabled).toBe(true);
      expect(root.textContent).not.toContain("未提供渲染数据源 fetcher");
      expect(root.textContent).toContain("选择区域后查询");
    } finally { app.unmount(); root.remove(); }
  });
});
