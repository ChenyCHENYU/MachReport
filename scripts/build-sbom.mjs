import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgRoot = join(root, "packages/mach-report"), out = join(pkgRoot, "dist");
const manifest = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
const entryRoots = { pdf: ["pdf-lib", "@pdf-lib/fontkit"], xlsx: ["exceljs"], "xlsx/node": ["exceljs"], sql: ["node-sql-parser"], codes: ["@bwip-js/generic", "fast-png"] };
const nodes = new Map(), scanned = new Set();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function packageDirectory(name, from) {
  const require = createRequire(join(from, "package.json"));
  for (const base of require.resolve.paths(name) ?? []) {
    const candidate = join(base, name, "package.json");
    if (existsSync(candidate)) return dirname(realpathSync(candidate));
  }
  let entry;
  try { entry = require.resolve(`${name}/package.json`); } catch { entry = require.resolve(name); }
  let path = dirname(entry);
  while (dirname(path) !== path) {
    const candidate = join(path, "package.json");
    if (existsSync(candidate) && JSON.parse(readFileSync(candidate, "utf8")).name === name) return path;
    path = dirname(path);
  }
  throw new Error(`Cannot identify installed package ${name}`);
}
function inventory(name, from, entry) {
  const path = packageDirectory(name, from), pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  const ref = `pkg:npm/${pkg.name.replace("@", "%40")}@${pkg.version}`;
  let node = nodes.get(ref);
  if (!node) { node = { ref, path, pkg, entries: new Set(), dependencies: new Set() }; nodes.set(ref, node); }
  node.entries.add(entry);
  const key = `${ref}:${entry}`;
  if (scanned.has(key)) return ref;
  scanned.add(key);
  for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) node.dependencies.add(inventory(dependency, path, entry));
  return ref;
}
for (const [entry, dependencies] of Object.entries(entryRoots)) for (const dependency of dependencies) inventory(dependency, pkgRoot, entry);
mkdirSync(join(out, "licenses"), { recursive: true });
const components = [];
for (const node of [...nodes.values()].sort((a, b) => a.ref.localeCompare(b.ref))) {
  const { pkg, path, ref } = node;
  // Keep upstream copyright/notice texts, not only a license identifier.
  let files = readdirSync(path).filter(file => /^(licen[sc]e|copying|notice)(\.|$|-)/i.test(file));
  if (!files.length) files = readdirSync(path).filter(file => /^readme(\.|$)/i.test(file) && /licen[sc]e/i.test(readFileSync(join(path, file), "utf8")));
  const missingNotice = !files.length;
  if (missingNotice) files = ["package.json", ...readdirSync(path).filter(file => /^readme(\.|$)/i.test(file))];
  const texts = files.sort().map(file => ({ file, bytes: readFileSync(join(path, file)) }));
  const licenseFile = `licenses/${pkg.name.replace(/[^\w.-]/g, "_")}-${pkg.version}.txt`;
  writeFileSync(join(out, licenseFile), texts.map(({ file, bytes }) => `--- ${file} ---\n${bytes.toString("utf8")}`).join("\n\n"));
  const license = typeof pkg.license === "string" ? pkg.license : pkg.license?.type;
  components.push({ type: "library", "bom-ref": ref, name: pkg.name, version: pkg.version, purl: ref,
    scope: "optional", ...(license ? { licenses: [{ license: { name: license } }] } : {}),
    hashes: [{ alg: "SHA-256", content: hash(readFileSync(join(path, "package.json"))) }],
    properties: [{ name: "mach-report:notice-status", value: missingNotice ? "upstream-not-supplied" : "upstream-text-included" }, { name: "mach-report:optional-entries", value: [...node.entries].sort().join(",") }, { name: "mach-report:license-file", value: licenseFile }] });
}
const files = readdirSync(out).filter(file => /\.(c?js|css)$/.test(file)).sort();
const artifactHashes = Object.fromEntries(files.map(file => [file, hash(readFileSync(join(out, file)))]));
const sbom = { bomFormat: "CycloneDX", specVersion: "1.6", version: 1,
  metadata: { component: { type: "library", name: manifest.name, version: manifest.version }, properties: [
    { name: "mach-report:inventory-scope", value: "Resolved runtime dependency closure of optional bundled libraries; conservative for prebundled upstream distributions. Vue peer and Node types remain external." },
    { name: "mach-report:pnpm-lock-sha256", value: hash(readFileSync(join(root, "pnpm-lock.yaml"))) }
  ] }, components, dependencies: [...nodes.values()].sort((a, b) => a.ref.localeCompare(b.ref)).map(node => ({ ref: node.ref, dependsOn: [...node.dependencies].sort() })) };
writeFileSync(join(out, "sbom.cdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
writeFileSync(join(out, "artifact-integrity.json"), `${JSON.stringify({ version: manifest.version, algorithm: "sha256", files: artifactHashes }, null, 2)}\n`);
console.log(`SBOM: ${components.length} resolved optional runtime components, upstream licenses and ${files.length} artifact hashes`);

for (const component of components) if (component.properties.some(item => item.name === "mach-report:notice-status" && item.value === "upstream-not-supplied")) console.log(`Upstream notice not supplied: ${component.name}@${component.version}; original metadata retained`);
