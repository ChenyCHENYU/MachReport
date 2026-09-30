import { copyFileSync, existsSync } from "node:fs";

/**
 * 复制入口 .d.ts → .d.cts（require 条件的类型出口，对齐双格式声明）。
 * 仅处理 exports 指向的入口声明（嵌套声明由 TS 相对解析，无需复制）。
 */
const entries = [
  "dist/index.d.ts",
  "dist/pdf.d.ts",
  "dist/sql.d.ts",
  "dist/manager.d.ts",
  "dist/xlsx.d.ts",
  "dist/vue/index.d.ts",
  "dist/vue/async.d.ts"
];
let count = 0;
for (const from of entries) {
  if (existsSync(from)) {
    copyFileSync(from, from.replace(/\.d\.ts$/, ".d.cts"));
    count++;
  }
}
console.log(`copied ${count} entry .d.cts files`);
