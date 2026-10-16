import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

/** Node 流式适配器独立构建，避免 ExcelJS 的 Node I/O 进入浏览器入口。 */
export default defineConfig({
  plugins: [dts({
    tsconfigPath: "./tsconfig.json", outDir: "dist/.node-types", entryRoot: "src", rollupTypes: true,
    bundledPackages: ["exceljs"], include: ["src/**/*.ts"], exclude: ["src/**/__tests__/**"],
    beforeWriteFile(filePath, content) {
      return { filePath, content: content.includes('/// <reference types="node" />') ? content : `/// <reference types="node" />\n${content}` };
    }
  })],
  resolve: { conditions: ["node"], mainFields: ["module", "main"] },
  build: {
    emptyOutDir: false, target: "node18",
    lib: { entry: { "xlsx-node": "src/xlsx/node.ts", "server-node": "src/server/node.ts" }, formats: ["es", "cjs"], fileName: (format, name) => `${name}.${format === "es" ? "js" : "cjs"}` },
    rollupOptions: {
      external: (id) => id.startsWith("node:") || builtinModules.includes(id) || id.startsWith("@agile-team/mach-report"),
      output: { exports: "named" }
    }
  }
});
