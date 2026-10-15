import { ESLint } from "eslint";
import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "packages/mach-report/src");
const limit = 20;

async function productionFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await productionFiles(path));
    else if (/\.(?:ts|vue)$/.test(entry.name) && !/\.(?:bench|d)\.ts$/.test(entry.name)) files.push(path);
  }
  return files;
}

// ESLint 的同一条 complexity 规则同时承担硬门禁和量化，避免另写一套不一致的计数器。
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [{ rules: { complexity: ["warn", { max: 0 }] } }]
});
const files = await productionFiles(source);
const results = await eslint.lintFiles(files);
const functions = [];
const errors = [];
for (const result of results) {
  for (const message of result.messages) {
    if (message.ruleId !== "complexity") {
      if (message.severity === 2) errors.push(`${relative(root, result.filePath)}:${message.line} ${message.message}`);
      continue;
    }
    const match = message.message.match(/^(.*?) has a complexity of (\d+)\./);
    if (!match) throw new Error(`无法解析 ESLint 复杂度结果：${message.message}`);
    functions.push({ file: relative(root, result.filePath), line: message.line, function: match[1], complexity: Number(match[2]) });
  }
}
functions.sort((left, right) => right.complexity - left.complexity || left.file.localeCompare(right.file) || left.line - right.line);
const violations = functions.filter((entry) => entry.complexity > limit);
const result = {
  productionFiles: files.length,
  functions: functions.length,
  rule: "ESLint complexity (classic)",
  limit,
  maximum: functions[0]?.complexity ?? 0,
  violations: violations.length,
  highest: functions.slice(0, 12)
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) throw new Error(errors.join("\n"));
if (violations.length) throw new Error(`${violations.length} 个生产函数超过圈复杂度 ${limit}；请按职责拆分后重试`);
