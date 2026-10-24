import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
/** 真 worker 不经过 Vitest 模块代理：只转译本仓源码到临时 ESM，验证实际线程 RPC。 */
export async function compileWorkerModules(root: string, entries: string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const compile = async (source: string): Promise<string> => {
    const cached = files.get(source);
    if (cached) return cached;
    const target = resolve(root, relative(sourceRoot, source)).replace(/\.ts$/, ".mjs");
    files.set(source, target);
    const code = ts.transpileModule(await readFile(source, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const dependencies = [...code.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)];
    let rewritten = code;
    for (const match of dependencies) {
      const specifier = match[1]!;
      const base = resolve(dirname(source), specifier);
      const dependency = extname(base) ? base : existsSync(`${base}.ts`) ? `${base}.ts` : resolve(base, "index.ts");
      const output = await compile(dependency);
      let replacement = relative(dirname(target), output).split("\\").join("/");
      if (!replacement.startsWith(".")) replacement = `./${replacement}`;
      rewritten = rewritten.split(`"${specifier}"`).join(`"${replacement}"`).split(`'${specifier}'`).join(`'${replacement}'`);
    }
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, rewritten);
    return target;
  };
  for (const entry of entries) await compile(resolve(sourceRoot, entry));
  return files;
}
