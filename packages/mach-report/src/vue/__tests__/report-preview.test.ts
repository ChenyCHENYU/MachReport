import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportPreview from "../ReportPreview.vue";
import { createLocalFetcher } from "../local-adapter";
import { normalizeReportIds, joinReportIds } from "../adapters";
import type { PlanFetcher } from "../adapters";
import type { ReportTemplate } from "@agile-team/mach-report";

const demoTemplate: ReportTemplate = {
  pages: [
    {
      widthMm: 210,
      heightMm: 297,
      marginTopMm: 12,
      components: [
        {
          kind: "text",
          leftMm: 70,
          topMm: 3,
          widthMm: 70,
          heightMm: 10,
          text: "MachReport 演示",
          style: { fontSize: 14, bold: true, align: "center" }
        },
        {
          kind: "list",
          leftMm: 12,
          topMm: 18,
          widthMm: 186,
          dataset: "rows",
          fontSizePt: 10.5,
          columns: [
            { header: "序号", field: "no", widthMm: 30 },
            { header: "物料", field: "name", widthMm: 90 },
            { header: "数量", field: "qty", widthMm: 66 }
          ]
        }
      ]
    }
  ]
};

function datasets(n: number) {
  return {
    rows: Array.from({ length: n }, (_, i) => ({
      no: String(i + 1),
      name: `物料-${i + 1}`,
      qty: (i + 1) * 5
    }))
  };
}

describe("ReportPreview 契约", () => {
  it("props 未传显隐项时走配置中心，缺省全开", () => {
    const wrapper = mount(ReportPreview, {
      props: { fetcher: null, reportId: null }
    });
    expect(wrapper.props("height")).toBe("100vh");
    expect(wrapper.props("autoLoad")).toBe(true);
    // 显隐 props 缺省 undefined → 解析链落到配置中心内置缺省（true）
    expect(wrapper.props("showExport")).toBeUndefined();
    expect(wrapper.props("showPrint")).toBeUndefined();
    expect(wrapper.props("showPdfWindow")).toBeUndefined();
    const toolbarText = wrapper.text();
    expect(toolbarText).toContain("导出 PDF");
    expect(toolbarText).toContain("打印");
    expect(toolbarText).toContain("PDF 窗口");
    expect(wrapper.props("params")).toEqual({});
  });

  it("autoLoad 拉取计划并 emit loaded(pageCount)", async () => {
    const fetcher = createLocalFetcher({
      T1: { template: demoTemplate, datasets: datasets(30) }
    });
    const onLoaded = vi.fn();
    const wrapper = mount(ReportPreview, {
      props: { reportId: "T1", fetcher, onLoaded }
    });
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("报表预览");
      expect(onLoaded).toHaveBeenCalled();
    });
    const pageCount = onLoaded.mock.calls[0]![0] as number;
    expect(pageCount).toBeGreaterThanOrEqual(1);
    await vi.waitFor(() => {
      expect(wrapper.element.querySelectorAll(".mr-page").length).toBe(pageCount);
    });
    expect(wrapper.text()).toContain("MachReport 演示");
    expect(wrapper.text()).toContain("物料-1");
  });

  it("reportId 变更自动重载（根治闪旧内容：先清空）", async () => {
    const fetcher = createLocalFetcher({
      A: { template: demoTemplate, datasets: datasets(3) },
      B: { template: demoTemplate, datasets: datasets(60) }
    });
    const wrapper = mount(ReportPreview, { props: { reportId: "A", fetcher } });
    await vi.waitFor(() => expect(wrapper.text()).toContain("物料-1"));
    const pagesA = wrapper.element.querySelectorAll(".mr-page").length;

    await wrapper.setProps({ reportId: "B" });
    await vi.waitFor(() => {
      const pagesB = wrapper.element.querySelectorAll(".mr-page").length;
      expect(pagesB).toBeGreaterThan(pagesA);
      expect(wrapper.text()).toContain("物料-60");
    });
  });

  it("缺报表 ID 显示错误且 emit error", async () => {
    const onError = vi.fn();
    const wrapper = mount(ReportPreview, {
      props: { reportId: null, fetcher: createLocalFetcher({}), onError }
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(wrapper.text()).toContain("缺少报表 ID");
  });

  it("fetcher 抛错显示错误态与重试按钮", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("后端超时"));
    const onError = vi.fn();
    const wrapper = mount(ReportPreview, {
      props: { reportId: "X", fetcher: failing as unknown as PlanFetcher, onError }
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(wrapper.text()).toContain("后端超时");
    expect(wrapper.find(".mrp-retry").exists()).toBe(true);
  });

  it("expose 契约方法齐全", () => {
    const wrapper = mount(ReportPreview, { props: { reportId: null } });
    const exposed = wrapper.vm as unknown as Record<string, unknown>;
    for (const key of ["reload", "print", "exportAs", "openPdfWindow", "gotoPage"]) {
      expect(typeof exposed[key]).toBe("function");
    }
  });

  it("翻页按钮更新页码", async () => {
    const fetcher = createLocalFetcher({
      A: { template: demoTemplate, datasets: datasets(120) }
    });
    const wrapper = mount(ReportPreview, { props: { reportId: "A", fetcher } });
    await vi.waitFor(() =>
      expect(wrapper.element.querySelectorAll(".mr-page").length).toBeGreaterThan(1)
    );
    expect(wrapper.text()).toMatch(/1 \/ \d+/);
    const next = wrapper.findAll(".mrp-nav").find((b) => b.text().includes("下一页"))!;
    await next.trigger("click");
    await vi.waitFor(() => expect(wrapper.text()).toMatch(/2 \/ \d+/));
  });

  it("快速切换 reportId 时旧请求后返回不覆盖新数据（竞态防护）", async () => {
    type Resolvers = { resolve: (plan: unknown) => void };
    const pending = new Map<string, Resolvers>();
    const planOf = (label: string) => ({
      schemaVersion: "t",
      pages: [
        {
          pageWidthMm: 210,
          pageHeightMm: 297,
          components: [
            {
              kind: "text",
              leftMm: 10,
              topMm: 10,
              widthMm: 100,
              heightMm: 10,
              text: label
            }
          ]
        }
      ]
    });
    const fetcher = vi.fn(({ reportIds }: { reportIds: string[] }) =>
      reportIds[0] === "STALE"
        ? new Promise((resolve) => {
            pending.set("STALE", { resolve });
          })
        : new Promise((resolve) => {
            pending.set("FRESH", { resolve });
          })
    );
    const wrapper = mount(ReportPreview, {
      props: { reportId: "STALE", fetcher: fetcher as unknown as PlanFetcher }
    });
    await vi.waitFor(() => expect(pending.has("STALE")).toBe(true));
    await wrapper.setProps({ reportId: "FRESH" });
    await vi.waitFor(() => expect(pending.has("FRESH")).toBe(true));

    // 新请求先返回 → 显示 FRESH
    pending.get("FRESH")!.resolve(planOf("FRESH-DATA"));
    await vi.waitFor(() => expect(wrapper.text()).toContain("FRESH-DATA"));

    // 旧请求后返回 → 不得覆盖
    pending.get("STALE")!.resolve(planOf("STALE-DATA"));
    await new Promise((r) => setTimeout(r, 20));
    expect(wrapper.text()).not.toContain("STALE-DATA");
    expect(wrapper.text()).toContain("FRESH-DATA");
  });
});
describe("reportId 规整", () => {
  it("逗号串 / 数组 / 空值", () => {
    expect(normalizeReportIds("A,B,C")).toEqual(["A", "B", "C"]);
    expect(normalizeReportIds(["A", "B"])).toEqual(["A", "B"]);
    expect(normalizeReportIds(" A , B ")).toEqual(["A", "B"]);
    expect(normalizeReportIds(null)).toEqual([]);
    expect(normalizeReportIds("")).toEqual([]);
    expect(joinReportIds("A,B")).toBe("A,B");
  });
});
