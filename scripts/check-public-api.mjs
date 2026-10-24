import ts from "typescript";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), pkg = join(root, "packages/mach-report");
const manifest = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
const entries = Object.entries(manifest.publishConfig.exports).filter(([, value]) => typeof value === "object");
const paths = entries.map(([, value]) => join(pkg, value.import.types));
for (const path of paths) if (!existsSync(path)) throw new Error(`Build before reviewing public API: ${path}`);
const program = ts.createProgram(paths, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true });
const checker = program.getTypeChecker(), printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const declarations = new Map(), exports = {};
for (const [index, [entry]] of entries.entries()) {
  const source = program.getSourceFile(paths[index]), module = checker.getSymbolAtLocation(source);
  exports[entry] = {};
  for (const symbol of checker.getExportsOfModule(module).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const owned = (target.declarations ?? []).filter(node => node.getSourceFile().fileName.startsWith(join(pkg, "dist")));
    if (!owned.length) { exports[entry][symbol.name] = "external"; continue; }
    const text = owned.map(node => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile())).join("\n").trim();
    const key = `${symbol.name}:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
    declarations.set(key, text);
    exports[entry][symbol.name] = key;
  }
}
const assets = Object.fromEntries(Object.entries(manifest.publishConfig.exports).filter(([, value]) => typeof value === "string").map(([name, file]) => {
  if (!existsSync(join(pkg, file))) throw new Error(`Missing public asset: ${name} -> ${file}`);
  return [name, file];
}));
const result = `${JSON.stringify({ format: 2, assets, exports, declarations: Object.fromEntries([...declarations].sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`;
const baseline = join(root, "scripts/public-api.json");
if (process.argv.includes("--update")) { writeFileSync(baseline, result); console.log("Public API baseline updated; review the diff before committing"); }
else if (!existsSync(baseline) || readFileSync(baseline, "utf8") !== result) throw new Error("Public API changed. Review signatures and migration compatibility, then run pnpm check:api --update");
else console.log(`Public API checked: ${entries.length} code APIs + ${Object.keys(assets).length} assets, ${declarations.size} unique declarations`);
