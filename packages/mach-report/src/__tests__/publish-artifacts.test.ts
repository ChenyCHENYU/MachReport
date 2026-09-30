// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 发布产物零依赖守卫（mach-table 家族发布口径）：
 * - 依赖图必须为零：pdf-lib/fontkit/node-sql-parser 打进子路径产物而非 dependencies
 * - 双格式（.js/.cjs + .d.ts/.d.cts）与四入口齐备
 */
const pkgDir = resolve(__dirname, "../..");
const dist = resolve(pkgDir, "dist");
const built = existsSync(dist);

describe("mach-report 引擎发布产物（零运行时依赖单包）", () => {
  it("package.json 无 dependencies（重依赖已打进子路径产物）", () => {
    const pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      engines?: Record<string, string>;
    };
    expect(pkg.dependencies, "引擎不得声明运行时依赖").toBeUndefined();
    expect(pkg.devDependencies?.["pdf-lib"]).toBeTruthy();
    expect(pkg.engines?.node).toBe(">=18.0.0");
  });

  it.skipIf(!built)("四入口 × 双格式 × 双声明齐备", () => {
    for (const name of ["index", "pdf", "sql", "manager"]) {
      for (const suffix of [".js", ".cjs", ".d.ts", ".d.cts"]) {
        expect(existsSync(resolve(dist, `${name}${suffix}`)), `缺 dist/${name}${suffix}`).toBe(true);
      }
    }
  });

  it.skipIf(!built)("主入口产物不含 pdf-lib / sql-parser 代码，子路径产物包含", () => {
    const indexJs = readFileSync(resolve(dist, "index.js"), "utf8");
    expect(indexJs).not.toContain("PDFDocument");
    const pdfJs = readFileSync(resolve(dist, "pdf.js"), "utf8");
    expect(pdfJs.length).toBeGreaterThan(100_000); // pdf-lib 已内联（~数百 KB）
    const sqlJs = readFileSync(resolve(dist, "sql.js"), "utf8");
    expect(sqlJs.length).toBeGreaterThan(100_000); // node-sql-parser 已内联
  });
});
