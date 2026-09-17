import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toRenderPlan,
  validateRenderPlan,
  renderPlan
} from "../index";

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/gridplan-real.json"
);

/**
 * 真实契约对齐测试。
 * fixture 由 scripts/fetch-gridplan.mjs 生成（人工登录 SIT 一次后全自动）。
 * fixture 未生成时全部跳过（不阻塞 CI）；生成后即成为契约守门。
 */
const hasFixture = existsSync(FIXTURE);

describe("gridPlan 真实契约 fixture 守卫", () => {
  it.skipIf(hasFixture)("fixture 未生成：运行 scripts/fetch-gridplan.mjs（人工登录一次）后自动激活契约测试", () => {
    console.log(`[contract] 缺少 ${FIXTURE}`);
  });
});

describe.skipIf(!hasFixture)("jh4j gridPlan 真实契约对齐", () => {
  function loadRaw(): Record<string, unknown> {
    return JSON.parse(readFileSync(FIXTURE, "utf-8")) as Record<string, unknown>;
  }

  it("响应 code=200 且含 pages 数组", () => {
    const raw = loadRaw();
    expect(raw.code).toBe(200);
    const pages = (raw.data as Record<string, unknown>)?.pages;
    expect(Array.isArray(pages)).toBe(true);
    expect((pages as unknown[]).length).toBeGreaterThan(0);
  });

  it("toRenderPlan 解析成功", () => {
    const plan = toRenderPlan(loadRaw() as never);
    expect(plan.pages.length).toBeGreaterThan(0);
  });

  it("validateRenderPlan 无 error（未知 kind 仅允许 warning）", () => {
    const plan = toRenderPlan(loadRaw() as never);
    const result = validateRenderPlan(plan);
    const errorKinds = [...new Set(result.errors.map((e) => e.path.split(".").pop()))];
    expect(
      result.ok,
      `结构损坏字段：${errorKinds.join(",")}`
    ).toBe(true);
  });

  it("DOM 渲染不抛错且产出组件节点", () => {
    const plan = toRenderPlan(loadRaw() as never);
    const doc = document.implementation.createHTMLDocument("real");
    const el = renderPlan(plan, doc);
    expect(el.querySelectorAll(".mr-page").length).toBe(plan.pages.length);
    expect(el.querySelectorAll(".mr-comp").length).toBeGreaterThan(0);
  });

  it("页面几何字段与逆向 schema 一致（pageWidthMm/HeightMm 为有限正数）", () => {
    const plan = toRenderPlan(loadRaw() as never);
    for (const page of plan.pages) {
      expect(Number.isFinite(page.pageWidthMm)).toBe(true);
      expect(page.pageWidthMm).toBeGreaterThan(50);
      expect(page.pageHeightMm).toBeGreaterThan(50);
    }
  });
});
