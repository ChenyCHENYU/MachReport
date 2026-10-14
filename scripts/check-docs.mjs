import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackageReadme } from "../packages/mach-report/scripts/sync-readme.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["README.md", "AGENTS.md", "LICENSING.md"];
function collect(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(path);
    else if (path.endsWith(".md")) files.push(path);
  }
}
collect("docs");

const errors = [];
for (const file of files) {
  const source = readFileSync(resolve(root, file), "utf8");
  const links = [...source.matchAll(/\]\(([^\s)]+)\)|\b(?:src|href)="([^"]+)"/g)];
  for (const match of links) {
    const target = match[1] ?? match[2];
    if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0]);
    if (!existsSync(resolve(root, dirname(file), path))) errors.push(`${file}: missing ${target}`);
  }
}

const source = readFileSync(resolve(root, "README.md"), "utf8");
const published = buildPackageReadme(source);
if (/\]\(\.\/|\b(?:src|href)="\.\//.test(published)) errors.push("npm README still has repository-relative links");
const pkg = JSON.parse(readFileSync(resolve(root, "packages/mach-report/package.json"), "utf8"));
if (!source.includes(`source-${pkg.version}-`)) errors.push("README source version badge differs from package version");
for (const name of ["mach-report-logo.svg", "mach-report-icon.svg"]) {
  const svg = readFileSync(resolve(root, "assets", name), "utf8");
  if (!svg.includes("<svg") || !svg.includes("<title") || !svg.includes("viewBox=")) errors.push(`${name}: missing SVG accessibility/viewport metadata`);
}
if (errors.length > 0) throw new Error(errors.join("\n"));
console.log(`Documentation checked: ${files.length} files, npm README links, source version and SVG assets`);
