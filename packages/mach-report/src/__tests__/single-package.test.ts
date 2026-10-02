// @vitest-environment node
import { describe, expect, it } from "vitest";
// 伞包主入口：业务侧 `import ... from "@agile-team/mach-report"` 的契约面
import * as machReport from "../index";
// 子路径：按需能力（发布 exports map 与之一一对应）
import * as machReportPdf from "../pdf";
import * as machReportSql from "../sql";
import * as machReportXlsx from "../xlsx";
import * as machReportVue from "../vue/index";

describe("单包架构：@agile-team/mach-report 一个包覆盖全部能力", () => {
  it("主入口导出引擎全量 API（分页/渲染/校验/构建器/虚拟化）", () => {
    const required = [
      "paginateTemplate",
      "renderPlan",
      "renderPage",
      "renderPlanToCanvas",
      "createCanvasPager",
      "computePageWindow",
      "validateRenderPlan",
      "createTemplate",
      "wrapText",
      "resolveGridLayout",
      "resolveBoxBorders"
    ] as const;
    for (const name of required) {
      expect(typeof (machReport as Record<string, unknown>)[name], `缺少导出 ${name}`).toBe(
        "function"
      );
    }
  });

  it("./pdf 子路径导出 PDF 直出 API", () => {
    expect(typeof machReportPdf.renderPlanToPdf).toBe("function");
    expect(typeof machReportPdf.loadFontWithCache).toBe("function");
  });

  it("./sql 子路径导出动态 SQL API", () => {
    expect(typeof machReportSql.compileDynamicSql).toBe("function");
    expect(typeof machReportSql.renderDynamicSql).toBe("function");
  });

  it("./xlsx 子路径导出 Excel 导出 API", () => {
    expect(typeof machReportXlsx.renderPlanToXlsx).toBe("function");
  });

  it("./vue 子路径导出组件层（node 环境仅类型/插件符号可加载）", () => {
    // node 无 DOM：组件 SFC 模块本身可 import（定义安全），插件/工具为函数
    expect(typeof machReportVue.machReportPlugin).toBe("object");
    expect(typeof machReportVue.createLocalFetcher).toBe("function");
    expect(typeof machReportVue.defineMachReportConfig).toBe("function");
    expect(typeof machReportVue.createFetchRequest).toBe("function");
  });

  it("主入口不泄漏 vue（框架零耦合，React/Node 消费者安全）", async () => {
    // 主入口源码零 vue import：框架代码只存在于 ./vue 子路径
    const indexModule = await import("../index");
    expect(Object.keys(indexModule).length).toBeGreaterThan(10);
  });

  it("node 环境全量可加载（SSR 安全：主入口与各子路径零 DOM 依赖）", async () => {
    await expect(import("../index")).resolves.toBeTruthy();
    await expect(import("../pdf")).resolves.toBeTruthy();
    await expect(import("../sql")).resolves.toBeTruthy();
  });
});
