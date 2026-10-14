import { copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = resolve(packageDir, "../..");
const repositoryUrl = "https://github.com/ChenyCHENYU/MachReport";
const rawUrl = "https://raw.githubusercontent.com/ChenyCHENYU/MachReport/main";

/** npm 不提供仓库目录；发布 README 的图片与文档必须使用可访问的绝对地址。 */
export function buildPackageReadme(source) {
  function absoluteLink(target, image = false) {
    if (!target.startsWith("./")) return target;
    const [path, fragment] = target.slice(2).split("#");
    const directory = statSync(resolve(rootDir, path)).isDirectory();
    const base = image ? rawUrl : `${repositoryUrl}/${directory ? "tree" : "blob"}/main`;
    return `${base}/${path}${fragment ? `#${fragment}` : ""}`;
  }
  return source
    .replace(/(!?)\[([^\]\n]*)\]\((\.\/[^\s)]+)\)/g,
      (_, image, label, target) => `${image}[${label}](${absoluteLink(target, image === "!")})`)
    .replace(/\b(src|href)="(\.\/[^"]+)"/g,
      (_, attribute, target) => `${attribute}="${absoluteLink(target, attribute === "src")}"`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(resolve(packageDir, "README.md"), buildPackageReadme(readFileSync(resolve(rootDir, "README.md"), "utf8")));
  for (const name of ["LICENSE", "LICENSING.md"]) {
    copyFileSync(resolve(rootDir, name), resolve(packageDir, name));
  }
  console.log("README and licensing files synced into package");
}
