import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("../packages/mach-report/package.json", import.meta.url), "utf8"));
const path = fileURLToPath(new URL("../README.md", import.meta.url));
const source = readFileSync(path, "utf8")
  .replace(/source-[\d.]+(?:-[a-zA-Z0-9.]+)?-2563eb/g, `source-${pkg.version}-2563eb`)
  .replace(/Source version [^"]+/g, `Source version ${pkg.version}`)
  .replace(/当前源码版本为 `[^`]+`/g, `当前源码版本为 \`${pkg.version}\``);
writeFileSync(path, source);
console.log(`README source version synced: ${pkg.version}`);
