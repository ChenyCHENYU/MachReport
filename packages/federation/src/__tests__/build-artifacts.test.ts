import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/assets");

describe("federation 构建产物守卫（需先 pnpm --filter @mach-report/federation build）", () => {
  it("remoteEntry.js 存在", () => {
    expect(existsSync(resolve(dist, "remoteEntry.js"))).toBe(true);
  });

  it("expose 路径与 jh4j 契约对齐", () => {
    const entry = readFileSync(resolve(dist, "remoteEntry.js"), "utf-8");
    for (const expose of [
      "./mach-report/reportPreview",
      "./mach-report/reportHtmlPreview",
      "./mach-report/filePreview"
    ]) {
      expect(entry).toContain(expose);
    }
    expect(entry).toContain("mach-report");
  });

  it("remoteEntry 体积 < 8KB（gzip 目标 < 4KB）", () => {
    const stat = readFileSync(resolve(dist, "remoteEntry.js"));
    expect(stat.length).toBeLessThan(8 * 1024);
  });
});
