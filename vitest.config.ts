import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts", "examples/*/src/**/*.test.ts"],
    globals: false,
    setupFiles: ["./scripts/test-env.ts"],
    /** 失败直接暴露，发布与 CI 不以重试掩盖时序或性能回归。 */
    retry: 0,
    coverage: {
      provider: "v8",
      include: ["packages/mach-report/src/**/*.{ts,vue}"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      reporter: ["text", "html"],
      reportsDirectory: "coverage"
    }
  }
});
