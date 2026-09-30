import { copyFileSync, existsSync } from "node:fs";

/** 复制 .d.ts → .d.cts（require 条件类型出口，对齐引擎包双格式声明） */
for (const name of ["index", "async"]) {
  const from = `dist/${name}.d.ts`;
  if (existsSync(from)) {
    copyFileSync(from, `dist/${name}.d.cts`);
  }
}
console.log("copied .d.cts files");
