import { copyFileSync, existsSync, mkdirSync, renameSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 复制入口 .d.ts → .d.cts（require 条件的类型出口，对齐双格式声明）。
 * rollup 声明按 Vite 入口命名；先对齐已发布的 Vue 子路径，再复制 require 类型入口。
 */
for (const [from, to] of [
  ["dist/vue.d.ts", "dist/vue/index.d.ts"],
  ["dist/vue-async.d.ts", "dist/vue/async.d.ts"]
]) {
  if (!existsSync(from)) throw new Error(`Missing rolled declaration: ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

const entries = [
  "dist/index.d.ts",
  "dist/pdf.d.ts",
  "dist/sql.d.ts",
  "dist/xlsx.d.ts",
  "dist/vue/index.d.ts",
  "dist/vue/async.d.ts"
];
const vueEntry = "dist/vue/index.d.ts";
const vueDeclaration = readFileSync(vueEntry, "utf8");
// 对应 vite.config.ts 聚合前的临时移除，公开类型仍重导出同一个核心包。
writeFileSync(vueEntry, `export * from "@agile-team/mach-report";\n${vueDeclaration}`);
let count = 0;
for (const from of entries) {
  if (existsSync(from)) {
    copyFileSync(from, from.replace(/\.d\.ts$/, ".d.cts"));
    count++;
  } else {
    throw new Error(`Missing public declaration: ${from}`);
  }
}
console.log(`copied ${count} entry .d.cts files`);
