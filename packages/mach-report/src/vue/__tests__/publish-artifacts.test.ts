// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 发布产物守卫（单包架构：@agile-team/mach-report 一个包含全部能力）：
 * 构建（vite 六入口）后 dist 必须满足 npm 消费者的完整契约。
 * CI 中 `pnpm build` 先于 `pnpm test` 时生效；本地未构建时跳过（dev 源码模式）。
 */
const dist = resolve(__dirname, "../../../dist");
const built = existsSync(dist);
const nodeFs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");

describe("单包发布产物（框架子路径 ./vue 契约）", () => {
  it.skipIf(!built)("六入口 × 双格式齐备", async () => {
    const fs = await import("node:fs");
    for (const f of [
      "index.js", "index.cjs",
      "pdf.js", "pdf.cjs",
      "sql.js", "sql.cjs",
      "manager.js", "manager.cjs",
      "vue.js", "vue.cjs",
      "vue-async.js", "vue-async.cjs",
      "style.css"
    ]) {
      expect(fs.existsSync(resolve(dist, f)), `缺 dist/${f}`).toBe(true);
    }
  });

  it.skipIf(!built)("vue 入口外部化框架与引擎（自引用），pdf-lib 不内联", () => {
    const vueJs = readFileSync(resolve(dist, "vue.js"), "utf8");
    // 入口 + 其共享分片整体扫描（vue 依赖在分片中，barrel 只做再导出）
    const chunks = nodeFs
      .readdirSync(dist)
      .filter((f) => f.endsWith(".js"))
      .map((f) => nodeFs.readFileSync(resolve(dist, f), "utf8"))
      .join("\n");
    expect(chunks).toMatch(/from\s?"vue"/);
    // 引擎经包名自引用（运行时走本包 exports，引擎代码全局单份）
    expect(vueJs + chunks).toContain("@agile-team/mach-report");
    expect(vueJs).not.toContain("pdf-lib");
  });

  it.skipIf(!built)("引擎主入口零框架耦合（vue 子路径产物不进主入口）", () => {
    const indexJs = readFileSync(resolve(dist, "index.js"), "utf8");
    expect(indexJs).not.toMatch(/from\s?"vue"|require\("vue"\)/);
  });

  it.skipIf(!built)("vue 类型声明齐备且含组件/插件符号", () => {
    const dts = readFileSync(resolve(dist, "vue/index.d.ts"), "utf8");
    expect(dts).toContain("ReportPreview");
    const pluginDts = readFileSync(resolve(dist, "vue/plugin.d.ts"), "utf8");
    expect(pluginDts).toContain("machReportPlugin");
    expect(existsSync(resolve(dist, "vue/index.d.cts"))).toBe(true);
  });

  it.skipIf(!built)("类型声明不含测试文件", () => {
    expect(existsSync(resolve(dist, "vue/__tests__"))).toBe(false);
    expect(existsSync(resolve(dist, "__tests__"))).toBe(false);
  });
});
