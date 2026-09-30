import { copyFileSync, existsSync } from "node:fs";

/**
 * 复制各入口 .d.ts → .d.cts（require 条件的类型出口，对齐 mach-table 双格式声明）。
 * 声明内容格式无关，直接复制即可。
 */
const entries = ["index", "pdf", "sql", "manager"];
for (const name of entries) {
  const from = `dist/${name}.d.ts`;
  if (existsSync(from)) {
    copyFileSync(from, `dist/${name}.d.cts`);
  }
}
console.log(`copied ${entries.length} .d.cts files`);
