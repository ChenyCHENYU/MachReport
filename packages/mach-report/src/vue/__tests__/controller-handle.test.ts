// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { useMachReport, type MachReportController } from "../controller";
import { MachReportError } from "../errors";

function controller(): MachReportController {
  return {
    reload: vi.fn().mockResolvedValue(undefined),
    print: vi.fn().mockResolvedValue(undefined),
    exportAs: vi.fn().mockResolvedValue(undefined),
    openPdfWindow: vi.fn(),
    gotoPage: vi.fn(),
    setParams: vi.fn().mockResolvedValue(undefined)
  };
}

describe("useMachReport 父组件入口", () => {
  it("未挂载和卸载后提供明确 config 错误，ready 与 ref 同步", async () => {
    const report = useMachReport();
    expect(report.ready.value).toBe(false);
    await expect(report.reload()).rejects.toMatchObject({ code: "config" });
    await expect(report.print()).rejects.toBeInstanceOf(MachReportError);
    await expect(report.exportAs("xlsx")).rejects.toMatchObject({ code: "config" });
    await expect(report.setParams({ id: "1" })).rejects.toMatchObject({ code: "config" });
    expect(() => report.openPdfWindow()).toThrow(MachReportError);
    expect(() => report.gotoPage(1)).toThrow(MachReportError);
    report.ref(controller());
    expect(report.ready.value).toBe(true);
    report.ref(null);
    expect(report.ready.value).toBe(false);
    await expect(report.reload()).rejects.toMatchObject({ code: "config" });
  });

  it("方法保持稳定并代理当前实例，异步方法等待实际操作完成", async () => {
    const report = useMachReport();
    const exportAs = report.exportAs;
    const first = controller();
    let finish!: () => void;
    first.exportAs = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    report.ref(first);
    let settled = false;
    const pending = exportAs("xlsx").then(() => { settled = true; });
    await flushPromises();
    expect(settled).toBe(false);
    finish();
    await pending;
    expect(first.exportAs).toHaveBeenCalledWith("xlsx");
    const second = controller();
    report.ref(second);
    expect(report.exportAs).toBe(exportAs);
    await report.reload();
    await report.print();
    await exportAs("pdf");
    report.openPdfWindow();
    report.gotoPage(3);
    await report.setParams({ id: "2" }, { reload: false });
    expect(second.reload).toHaveBeenCalledOnce();
    expect(second.print).toHaveBeenCalledOnce();
    expect(second.exportAs).toHaveBeenCalledWith("pdf");
    expect(second.openPdfWindow).toHaveBeenCalledOnce();
    expect(second.gotoPage).toHaveBeenCalledWith(3);
    expect(second.setParams).toHaveBeenCalledWith({ id: "2" }, { reload: false });
  });

  it("Vue 组件 ref 直接接入句柄；卸载自动撤销 ready", async () => {
    const report = useMachReport();
    const api = controller();
    const Preview = defineComponent({
      setup(_, { expose }) {
        expose(api);
        return () => h("div");
      }
    });
    const wrapper = mount(() => h(Preview, { ref: report.ref }));
    expect(report.ready.value).toBe(true);
    await report.exportAs("xlsx");
    expect(api.exportAs).toHaveBeenCalledWith("xlsx");
    wrapper.unmount();
    expect(report.ready.value).toBe(false);
  });
});
