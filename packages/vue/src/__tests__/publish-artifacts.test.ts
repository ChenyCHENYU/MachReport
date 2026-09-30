// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 发布产物守卫（对齐 mach-table 家族的发布质量口径）：
 * 构建（vite lib）后 dist 必须满足 npm 消费者的完整契约。
 * CI 中 `pnpm build` 先于 `pnpm test` 时生效；本地未构建时跳过（dev 源码模式）。
 */
const dist = resolve(__dirname, "../../dist");
const built = existsSync(dist);

describe("mach-report-vue 发布产物（单包安装契约）", () => {
  it.skipIf(!built)("dist 产物存在且外部化引擎与 vue（跨入口分片）", async () => {
    const fs = await import("node:fs");
    for (const f of ["index.js", "index.cjs", "async.js", "async.cjs", "style.css"]) {
      expect(fs.existsSync(resolve(dist, f)), `缺 dist/${f}`).toBe(true);
    }
    // 入口 + 共享分片整体扫描：vue 与引擎必须外部化、pdf-lib 不得内联
    const chunks = fs
      .readdirSync(dist)
      .filter((f) => f.endsWith(".js") || f.endsWith(".cjs"))
      .map((f) => fs.readFileSync(resolve(dist, f), "utf8"))
      .join("\n");
    expect(chunks).toMatch(/from\s?"vue"|require\("vue"\)/);
    expect(chunks).toContain("@agile-team/mach-report");
    // PDF 懒加载保留为运行时子路径导入（不内联 pdf-lib）
    expect(chunks).toContain('import("@agile-team/mach-report/pdf")');
    expect(chunks).not.toContain("pdf-lib");
  });

  it.skipIf(!built)("dist/index.d.ts 含组件类型与样式出口", () => {
    const dts = readFileSync(resolve(dist, "index.d.ts"), "utf8");
    expect(dts).toContain("ReportPreview");
    // 插件符号在再导出的类型分片中
    const pluginDts = readFileSync(resolve(dist, "plugin.d.ts"), "utf8");
    expect(pluginDts).toContain("machReportPlugin");
    expect(existsSync(resolve(dist, "style.css"))).toBe(true);
  });

  it.skipIf(!built)("类型声明不含测试文件", () => {
    expect(existsSync(resolve(dist, "__tests__"))).toBe(false);
  });
});
