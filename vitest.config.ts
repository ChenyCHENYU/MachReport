import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
    globals: false,
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
