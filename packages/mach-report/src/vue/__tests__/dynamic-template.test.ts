// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createTemplateRegistry, defineReportTemplate, type ReportTemplate, type ReportLoadContext } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import { machReportPlugin } from "../plugin";

let wrapper: VueWrapper | undefined;
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks(); document.body.replaceChildren(); });

function template(text: string): ReportTemplate {
  return { pages: [{ widthMm: 210, heightMm: 100, components: [{ kind: "text", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 10, text }] }] };
}

describe("Vue 插件动态模板", () => {
  it("reports 保持一层配置，查询面板不加载模板，重载读取目录最新版本", async () => {
    const registry = createTemplateRegistry([defineReportTemplate({ id: "sales", name: "销售", revision: "1", template: template("第一版") })]);
    const dynamic = vi.fn((context: ReportLoadContext) => {
      expect(context.params).toEqual({ month: "2026-10" });
      expect(context.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve(registry.get(context.reportId)!.template);
    });
    wrapper = mount(ReportPreview, {
      props: { reportId: "sales", autoLoad: false },
      global: { plugins: [[machReportPlugin, {
        reports: { sales: { template: dynamic, params: [{ field: "month", label: "月份", defaultValue: "2026-10" }] } },
        globalComponent: false
      }]] }
    });
    await flushPromises();
    expect(wrapper.find('input').exists()).toBe(true);
    expect(dynamic).not.toHaveBeenCalled();
    const preview = wrapper.vm as unknown as { reload(): Promise<void> };
    await preview.reload();
    await flushPromises();
    expect(wrapper.text()).toContain("第一版");
    registry.register(defineReportTemplate({ id: "sales", name: "销售", revision: "2", template: template("第二版") }), { replace: true });
    await preview.reload();
    await flushPromises();
    expect(wrapper.text()).toContain("第二版");
    expect(wrapper.text()).not.toContain("第一版");
    expect(dynamic).toHaveBeenCalledTimes(2);
  });
});
