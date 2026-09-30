import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

/**
 * 库构建（发布产物）：
 * - ES 单入口 dist/index.js；SFC 样式抽离为 dist/style.css（发布出口 ./style.css）
 * - vue 与 @agile-team/mach-report(引擎单包) 外部化——适配包只含组件层，
 *   引擎及其 /pdf 子路径在运行时按依赖解析（懒加载分片天然成立）
 * - dts：vue-tsc 生成含 .vue 的类型声明
 */
export default defineConfig({
  plugins: [
    vue(),
    dts({
      tsconfigPath: "./tsconfig.json",
      outDir: "dist",
      cleanVueFileName: true,
      exclude: ["src/__tests__/**", "**/*.test.ts"]
    })
  ],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js"
    },
    rollupOptions: {
      external: (id) => id === "vue" || id.startsWith("@agile-team/mach-report"),
      output: {
        assetFileNames: (info) => (info.names?.some((n) => n.endsWith(".css")) ? "style.css" : (info.names?.[0] ?? "asset"))
      }
    }
  }
});
