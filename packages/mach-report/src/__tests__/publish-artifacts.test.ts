// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 发布产物零依赖守卫（mach-table 家族发布口径）：
 * - 运行时代码依赖为零：重依赖打进子路径产物；仅 @types/node 支撑完整 Workbook 类型
 * - 双格式（.js/.cjs + .d.ts/.d.cts）与公开入口齐备
 */
const pkgDir = resolve(__dirname, "../..");
const dist = resolve(pkgDir, "dist");
const built = existsSync(dist);

/** Follow the static ESM closure: optional font loading can split PDF into shared chunks. */
function staticModuleCode(entry: string): string {
  const seen = new Set<string>();
  function visit(file: string): string {
    if (seen.has(file)) return "";
    seen.add(file);
    const code = readFileSync(file, "utf8");
    const dependencies = [...code.matchAll(/(?:from\s*|import\s*)["'](\.\/[^"']+\.js)["']/g)];
    return [code, ...dependencies.map(match => visit(resolve(dirname(file), match[1]!)))].join("\n");
  }
  return visit(resolve(dist, entry));
}

describe("mach-report 引擎发布产物（零运行时依赖单包）", () => {
  it("package.json 仅声明 Node 类型依赖（重依赖已打进子路径产物）", () => {
    const pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      engines?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}), "引擎不得声明运行时代码依赖").toEqual(["@types/node"]);
    expect(pkg.dependencies?.["@types/node"]).toBeTruthy();
    expect(pkg.devDependencies?.["pdf-lib"]).toBeTruthy();
    expect(pkg.engines?.node).toBe(">=18.0.0");
  });

  it.skipIf(!built)("公开入口 × 双格式 × 双声明齐备", () => {
    for (const name of ["index", "pdf", "sql", "xlsx", "vue", "vue-async", "server", "server-node", "worker", "analytics", "designer", "xlsx-node", "codes"]) {
      for (const suffix of [".js", ".cjs"]) {
        expect(existsSync(resolve(dist, `${name}${suffix}`)), `缺 dist/${name}${suffix}`).toBe(true);
      }
    }
    for (const name of ["index", "pdf", "sql", "xlsx", "vue/index", "vue/async", "server", "server/node", "worker", "analytics", "designer", "xlsx/node", "codes"]) {
      for (const suffix of [".d.ts", ".d.cts"]) expect(existsSync(resolve(dist, `${name}${suffix}`)), `缺 dist/${name}${suffix}`).toBe(true);
    }
  });

  it.skipIf(!built)("主入口产物不含 pdf-lib / sql-parser 代码，子路径产物包含", () => {
    const indexJs = staticModuleCode("index.js");
    expect(indexJs).not.toContain("PDFDocument");
    expect(indexJs).not.toMatch(/bwip|BWIPP|fast-png|BarcodeWriter|pngEncode/);
    expect(indexJs).not.toMatch(/(?:from\s*|import\s*\()['"](?:vue|node:|exceljs|@agile-team\/mach-report\/(?:pdf|xlsx|server|designer))/);
    const pdfJs = staticModuleCode("pdf.js");
    expect(pdfJs.length).toBeGreaterThan(100_000); // pdf-lib 已内联（~数百 KB）
    expect(pdfJs).toContain("PDFDocument");
    const sqlJs = staticModuleCode("sql.js");
    expect(sqlJs.length).toBeGreaterThan(100_000); // node-sql-parser 已内联
  });

  it.skipIf(!built)("码图引擎只通过独立入口提供，不被框架默认入口加载", () => {
    for (const name of ["index", "vue", "vue-async", "designer"]) {
      const code = readFileSync(resolve(dist, `${name}.js`), "utf8");
      expect(code).not.toMatch(/(?:from\s*|import\s*\()['"][^'"]*(?:\/codes|@bwip-js|fast-png)/);
    }
    expect(readFileSync(resolve(dist, "codes.js"), "utf8")).toContain("createCodeAssetRenderers");
  });

  it.skipIf(!built)("设计器产物兼容缺少原生克隆API的门户", () => {
    for (const extension of ["js", "cjs"]) expect(readFileSync(resolve(dist, `designer.${extension}`), "utf8")).not.toMatch(/\bstructuredClone\s*\(/u);
  });

  it.skipIf(!built)("XLSX 声明内联完整 Workbook API，不要求宿主安装 ExcelJS", () => {
    const dts = readFileSync(resolve(dist, "xlsx.d.ts"), "utf8");
    expect(dts).not.toMatch(/(?:from\s*|import\s*\()(['"])exceljs\1/);
    expect(dts).toContain('/// <reference types="node" />');
    expect(dts).toContain("XlsxRenderResult");
    expect(dts).toContain("addWorksheet(");
    expect(dts).toContain("getWorksheet(");
    expect(dts).toContain("writeBuffer(");
  });
});
