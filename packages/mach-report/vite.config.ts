import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

/**
 * 单包发布构建（六入口 × ESM/CJS 双格式）：
 *
 * - index/pdf/sql/manager：框架无关引擎与重依赖子路径（pdf-lib/fontkit 内联进
 *   pdf 入口、node-sql-parser 内联进 sql 入口——不导入即不进依赖图）
 * - vue / vue-async：框架子路径（SFC 组件 + 插件/配置中心），样式抽离 dist/style.css
 * - 外部化：vue（optional peer）与包自身子路径（自引用 self-reference：
 *   vue 入口静态依赖引擎主入口、pdf 懒加载走 ./pdf 子路径——运行时经本包
 *   exports 解析，引擎代码全局单份）
 * - dts：vue-tsc 生成含 .vue 的声明；构建脚本另复制 .d.cts（require 类型出口）
 */
export default defineConfig({
  plugins: [
    vue(),
    dts({
      tsconfigPath: "./tsconfig.json",
      outDir: "dist",
      entryRoot: "src",
      cleanVueFileName: true,
      exclude: ["src/**/__tests__/**", "**/*.test.ts"]
    })
  ],
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        pdf: "src/pdf.ts",
        sql: "src/sql.ts",
        manager: "src/manager.ts",
        xlsx: "src/xlsx.ts",
        vue: "src/vue/index.ts",
        "vue-async": "src/vue/async.ts"
      },
      formats: ["es", "cjs"],
      fileName: (format, name) => (format === "es" ? `${name}.js` : `${name}.cjs`)
    },
    rollupOptions: {
      external: (id) => id === "vue" || id.startsWith("@agile-team/mach-report"),
      output: {
        assetFileNames: (info) =>
          info.names?.some((n) => n.endsWith(".css")) ? "style.css" : (info.names?.[0] ?? "asset")
      }
    }
  }
});
