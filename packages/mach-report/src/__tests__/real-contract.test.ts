// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toRenderPlan,
  validateRenderPlan,
  renderPlan
} from "../index";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures"
);
const fixtures = existsSync(FIXTURE_DIR)
  ? readdirSync(FIXTURE_DIR)
    .filter((name) => /^gridplan-real(?:-[a-zA-Z0-9_-]+)?\.json$/.test(name))
    .map((name) => resolve(FIXTURE_DIR, name))
  : [];
const fixtureCases = fixtures.length > 0
  ? fixtures.map((file) => ({ name: basename(file), file }))
  : [{ name: "待采集", file: resolve(FIXTURE_DIR, "gridplan-real.json") }];

/**
 * 真实契约对齐测试。
 * fixture 由 scripts/fetch-gridplan.mjs 生成（人工登录一次后全自动）。
 * 可逐张采集多份样本；未生成时全部跳过（不阻塞 CI）。
 */
describe("gridPlan 真实契约 fixture 守卫", () => {
  it.skipIf(fixtures.length > 0)("fixture 未生成：运行 scripts/fetch-gridplan.mjs（人工登录一次）后自动激活契约测试", () => {
    console.log(`[contract] 缺少 ${FIXTURE_DIR} 下的 gridplan-real*.json`);
  });
});

describe.each(fixtureCases)("jh4j gridPlan 真实契约对齐：$name", ({ file }) => {
  function loadRaw(): Record<string, unknown> {
    return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
  }

  it.skipIf(fixtures.length === 0)("响应 code=200 且含 pages 数组", () => {
    const raw = loadRaw();
    expect(raw.code).toBe(200);
    const pages = (raw.data as Record<string, unknown>)?.pages;
    expect(Array.isArray(pages)).toBe(true);
    expect((pages as unknown[]).length).toBeGreaterThan(0);
  });

  it.skipIf(fixtures.length === 0)("toRenderPlan 解析成功", () => {
    const plan = toRenderPlan(loadRaw() as never);
    expect(plan.pages.length).toBeGreaterThan(0);
  });

  it.skipIf(fixtures.length === 0)("validateRenderPlan 无 error（未知 kind 仅允许 warning）", () => {
    const plan = toRenderPlan(loadRaw() as never);
    const result = validateRenderPlan(plan);
    const errorKinds = [...new Set(result.errors.map((e) => e.path.split(".").pop()))];
    expect(
      result.ok,
      `结构损坏字段：${errorKinds.join(",")}`
    ).toBe(true);
  });

  it.skipIf(fixtures.length === 0)("DOM 渲染不抛错且产出组件节点", () => {
    const plan = toRenderPlan(loadRaw() as never);
    const doc = document.implementation.createHTMLDocument("real");
    const el = renderPlan(plan, doc);
    expect(el.querySelectorAll(".mr-page").length).toBe(plan.pages.length);
    expect(el.querySelectorAll(".mr-comp").length).toBeGreaterThan(0);
  });

  it.skipIf(fixtures.length === 0)("页面几何字段与逆向 schema 一致（pageWidthMm/HeightMm 为有限正数）", () => {
    const plan = toRenderPlan(loadRaw() as never);
    for (const page of plan.pages) {
      expect(Number.isFinite(page.pageWidthMm)).toBe(true);
      expect(page.pageWidthMm).toBeGreaterThan(50);
      expect(page.pageHeightMm).toBeGreaterThan(50);
    }
  });
});
