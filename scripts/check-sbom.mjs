import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), pkg = join(root, "packages/mach-report"), dist = join(pkg, "dist");
const read = file => JSON.parse(readFileSync(file, "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const inventory = read(join(dist, "sbom.cdx.json")), integrity = read(join(dist, "artifact-integrity.json"));
if (inventory.metadata.component.version !== read(join(pkg, "package.json")).version) throw new Error("Stale SBOM version");
if (inventory.metadata.properties.find(item => item.name === "mach-report:pnpm-lock-sha256")?.value !== hash(readFileSync(join(root, "pnpm-lock.yaml")))) throw new Error("SBOM lockfile drift: rebuild");
for (const component of inventory.components) {
  const path = component.properties.find(item => item.name === "mach-report:license-file")?.value;
  if (!path || !existsSync(join(dist, path))) throw new Error(`Missing license for ${component.name}`);
}
for (const [file, expected] of Object.entries(integrity.files)) if (hash(readFileSync(join(dist, file))) !== expected) throw new Error(`Artifact changed after SBOM: ${file}`);
console.log(`SBOM verified: ${inventory.components.length} components, lockfile and built artifact integrity`);
