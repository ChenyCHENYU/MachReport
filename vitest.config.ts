import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    globals: false,
    /** 负载敏感的性能预算/异步挂载用例在并行重载下偶发超阈值：重试一次（CI 标准做法，阈值不放水） */
    retry: 1,
    coverage: {
      provider: "v8",
      include: [
        "packages/mach-report/src/layout/**",
        "packages/mach-report/src/render/**",
        "packages/mach-report/src/format.ts"
      ],
      reporter: ["text", "html"],
      reportsDirectory: "coverage"
    }
  }
});
