import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

/**
 * 库构建（发布产物，对齐 mach-table 发布口径）：
 * - 双入口：index（同步主入口）/ async（异步插件入口，组件拆独立 chunk）
 * - ESM + CJS 双格式；SFC 样式抽离 dist/style.css（发布出口 ./style.css）
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
      entry: {
        index: "src/index.ts",
        async: "src/async.ts"
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => (format === "es" ? `${entryName}.js` : `${entryName}.cjs`)
    },
    rollupOptions: {
      external: (id) => id === "vue" || id.startsWith("@agile-team/mach-report"),
      output: {
        assetFileNames: (info) => (info.names?.some((n) => n.endsWith(".css")) ? "style.css" : (info.names?.[0] ?? "asset"))
      }
    }
  }
});
