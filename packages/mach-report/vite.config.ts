import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

/**
 * 浏览器/共用入口构建（十一入口 × ESM/CJS 双格式；另两个Node入口独立构建）：
 *
 * - index/pdf/sql/xlsx：框架无关引擎与重依赖子路径（pdf-lib/fontkit 内联进
 *   pdf 入口、node-sql-parser 内联进 sql 入口——不导入即不进依赖图）
 * - vue / vue-async：框架子路径（SFC 组件 + 插件/配置中心），样式抽离 dist/style.css
 * - 外部化：vue（optional peer）与包自身子路径（自引用 self-reference：
 *   vue 入口静态依赖引擎主入口、pdf 懒加载走 ./pdf 子路径——运行时经本包
 *   exports 解析，引擎代码全局单份）
 * - server/worker/analytics：按需引入的共用运行时与扩展；designer为可选Vue属性面板
 * - dts：聚合入口声明，内联 ExcelJS 类型；构建脚本对齐子路径并复制 .d.cts
 */
export default defineConfig({
  plugins: [
    vue(),
    dts({
      tsconfigPath: "./tsconfig.json",
      outDir: "dist",
      entryRoot: "src",
      cleanVueFileName: true,
      rollupTypes: true,
      bundledPackages: ["exceljs"],
      beforeWriteFile(filePath, content) {
        // Vue SFC 推导会把可增补的 GlobalComponents interface 直接放入 Record 约束。
        // 映射成同字段类型，保留宿主全局组件信息，同时使严格消费端可验证索引约束。
        let normalized = content.replace(
          /, GlobalComponents, GlobalDirectives,/g,
          ", { [K in keyof GlobalComponents]: GlobalComponents[K] }, { [K in keyof GlobalDirectives]: GlobalDirectives[K] },"
        );
        // 自引用的 star export 会让 API Extractor 沿 package exports 回到 .ts 实现，
        // 引发语义分析错误。只在聚合前移除这行；最终声明由 copy-dcts 恢复外部重导出。
        // 保留外部重导出，避免将含 private 成员的核心类型复制成另一份名义类型。
        if (filePath.endsWith("/vue/index.d.ts")) {
          normalized = normalized.replace(/^export \* from ['"]@agile-team\/mach-report['"];?\r?\n/gm, "");
        }
        // 完整 Workbook API 含 Node stream 签名，types: [] 宿主也需显式解析 Node 声明。
        if (filePath.endsWith("/xlsx.d.ts") && !normalized.includes('/// <reference types="node" />')) {
          return { filePath, content: `/// <reference types="node" />\n${normalized}` };
        }
        return { filePath, content: normalized };
      },
      exclude: ["src/**/__tests__/**", "**/*.test.ts"]
    })
  ],
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        pdf: "src/pdf.ts",
        sql: "src/sql.ts",
        xlsx: "src/xlsx.ts",
        server: "src/server.ts",
        designer: "src/designer.ts",
        analytics: "src/analytics.ts",
        codes: "src/codes.ts",
        worker: "src/worker.ts",
        "report-encoding-worker": "src/worker/encoding-entry.ts",
        vue: "src/vue/index.ts",
        "vue-async": "src/vue/async.ts"
      },
      formats: ["es", "cjs"],
      fileName: (format, name) => (format === "es" ? `${name}.js` : `${name}.cjs`)
    },
    rollupOptions: {
      external: (id) => id === "vue" || id.startsWith("@agile-team/mach-report"),
      output: {
        exports: "named",
        assetFileNames: (info) =>
          info.names?.some((n) => n.endsWith(".css")) ? "style.css" : (info.names?.[0] ?? "asset")
      }
    }
  }
});
