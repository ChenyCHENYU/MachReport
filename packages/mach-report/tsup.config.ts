import { defineConfig } from "tsup";

/**
 * 引擎发布构建（对齐 mach-table 的 tsup 方案）：
 *
 * - 四入口独立成包：index（引擎核心）/ pdf / sql / manager 子路径各自独立产物，
 *   splitting 关闭 → 每个入口 standalone，不产生跨入口共享 chunk（cjs 消费最稳）
 * - 零 dependencies：pdf-lib / @pdf-lib/fontkit 打进 pdf 产物，
 *   node-sql-parser 打进 sql 产物；不导入子路径则完全不进依赖图
 * - 双格式：ESM（.js）+ CJS（.cjs），d.ts 每入口一份（构建脚本另复制 .d.cts）
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    pdf: "src/pdf.ts",
    sql: "src/sql.ts",
    manager: "src/manager.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: false,
  target: "es2020",
  treeshake: true,
  outDir: "dist"
});
