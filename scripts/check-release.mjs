import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pending = readdirSync(new URL("../.changeset/", import.meta.url))
  .filter((name) => name.endsWith(".md") && name !== "README.md");
if (pending.length) throw new Error("存在待合并 changeset：先运行 pnpm run version，检查并提交版本变更，再发布。");
const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
if (status) throw new Error("发布要求工作区干净：先提交并推送本次源码和版本变更，确保版本标签指向实际发布提交。");
const pkg = JSON.parse(readFileSync(new URL("../packages/mach-report/package.json", import.meta.url), "utf8"));
const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
console.log(`Release source checked: ${pkg.name}@${pkg.version}, commit ${head}`);
