import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import ReportBatchPanel from "../ReportBatchPanel.vue";
import type { ReportBatchCase } from "../../server/batch";
import type { ReportBatchReceipt } from "../useReportBatch";

function cases(): ReportBatchCase[] { return [{ id: "first", params: { month: "2026-09" } }, { id: "second", params: { month: "2026-10" } }]; }
async function click(wrapper: ReturnType<typeof mount>, text: string): Promise<void> {
  await wrapper.findAll("button").find(button => button.text().startsWith(text))!.trigger("click"); await flushPromises();
}
const defs = [{ field: "month", label: "月份", type: "month" as const, required: true }];

describe("bounded batch generation panel", () => {
  it("rejects oversized and accessor-bearing initial batches before allocating parameter forms or invoking getters", async () => {
    const execute = vi.fn(async () => ({})), getter = vi.fn(() => ({ month: "2026-10" }));
    const oversized = mount(ReportBatchPanel, { props: { execute, paramDefs: defs, initialCases: cases(), maxCases: 1 } });
    expect(oversized.findAll(".mr-batch__row")).toHaveLength(0); expect(oversized.get(".mr-batch__error").text()).toContain("maxCases"); oversized.unmount();
    const item = { id: "getter" } as ReportBatchCase; Object.defineProperty(item, "params", { enumerable: true, get: getter });
    // Pass through a real VNode: test-utils' own root-prop ref detection invokes getters.
    const host = mount(defineComponent({ setup: () => () => h(ReportBatchPanel, { execute, paramDefs: defs, initialCases: [item] }) }));
    const accessor = host.getComponent(ReportBatchPanel);
    expect(accessor.findAll(".mr-batch__row")).toHaveLength(0); expect(accessor.get(".mr-batch__error").text()).toContain("访问器");
    expect(getter).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled(); host.unmount();
  });
  it("mounts only ten parameter groups and locates errors outside the current page before execution", async () => {
    const initialCases = Array.from({ length: 21 }, (_, index) => ({ id: `row-${index + 1}`, params: { month: index === 20 ? "" : "2026-10" } }));
    const execute = vi.fn(async () => ({ instanceId: "saved" }));
    const wrapper = mount(ReportBatchPanel, { props: { execute, paramDefs: defs, initialCases }, attachTo: document.body });
    expect(wrapper.findAll(".mr-batch__row")).toHaveLength(10); expect(wrapper.get(".mr-batch__pagination").text()).toContain("第 1/3 页");
    await click(wrapper, "生成全部");
    expect(execute).not.toHaveBeenCalled(); expect(wrapper.findAll(".mr-batch__row")).toHaveLength(1);
    expect(wrapper.get(".mr-batch__pagination").text()).toContain("第 3/3 页"); expect(document.activeElement).toBe(wrapper.get('input[type="month"]').element);
    await wrapper.get('input[type="month"]').setValue("2026-10"); await click(wrapper, "生成全部");
    expect(execute).toHaveBeenCalledTimes(21); expect(wrapper.get(".mr-batch__progress").text()).toContain("已结束 21/21"); wrapper.unmount();
  });
  it("validates every case before dispatching any request and focuses the incomplete range endpoint", async () => {
    const execute = vi.fn(async () => ({ instanceId: "one" }));
    const wrapper = mount(ReportBatchPanel, { props: { execute, paramDefs: [{ field: "period", label: "期间", type: "dateRange", required: true }], initialCases: [
      { id: "valid", params: { period: "2026-10-01/2026-10-20" } }, { id: "partial", params: { period: "2026-10-20/" } },
    ] }, attachTo: document.body });
    await click(wrapper, "生成全部");
    expect(execute).not.toHaveBeenCalled(); expect(wrapper.get(".mr-batch__error").text()).toContain("本次未启动任何任务");
    expect(wrapper.findAll(".mrp-params-actions")).toHaveLength(0);
    expect(document.activeElement).toBe(wrapper.findAll('input[aria-label="期间 · 结束日期"]')[1]!.element); wrapper.unmount();
  });
  it("keeps successful receipts, retries only failures on explicit action and opens by returned instance ID", async () => {
    const attempts = new Map<string, number>();
    const execute = vi.fn(async (item: ReportBatchCase) => {
      attempts.set(item.id, (attempts.get(item.id) ?? 0) + 1);
      if (item.id === "second" && attempts.get(item.id) === 1) throw new Error("查询超时");
      return { instanceId: `instance-${item.id}`, label: `报表 ${item.id}` };
    });
    const wrapper = mount(ReportBatchPanel, { props: { execute, paramDefs: defs, initialCases: cases() } });
    await click(wrapper, "生成全部"); await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2)); await flushPromises();
    expect(wrapper.findAll(".mr-batch__row.is-completed")).toHaveLength(1); expect(wrapper.findAll(".mr-batch__row.is-failed")).toHaveLength(1);
    expect(wrapper.get(".mr-batch__row-error").text()).toBe("查询超时");
    await click(wrapper, "打开报表实例"); expect(wrapper.emitted("open-instance")?.[0]).toEqual([{ instanceId: "instance-first", label: "报表 first" }]);
    await click(wrapper, "仅重试失败项"); await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3)); await flushPromises();
    expect(attempts).toEqual(new Map([["first", 1], ["second", 2]]));
    expect(wrapper.findAll(".mr-batch__row.is-completed")).toHaveLength(2); expect(wrapper.find(".mr-batch__row-error").exists()).toBe(false);
    expect(wrapper.get(".mr-batch__progress").text()).toContain("已结束 1/1"); wrapper.unmount();
  });
  it("duplicates independent typed values, enforces the row budget and never mutates initial inputs", async () => {
    const initial = [{ id: "first", params: { month: "2026-10" } }];
    const execute = vi.fn(async (item: ReportBatchCase) => { item.params.month = "2000-01"; return {}; });
    const wrapper = mount(ReportBatchPanel, { props: { execute, paramDefs: defs, initialCases: initial, maxCases: 2 } });
    await click(wrapper, "复制参数"); expect(wrapper.findAll(".mr-batch__row")).toHaveLength(2);
    const inputs = wrapper.findAll('input[type="month"]'); await inputs[1]!.setValue("2026-11");
    expect((inputs[0]!.element as HTMLInputElement).value).toBe("2026-10");
    expect(wrapper.findAll("button").find(button => button.text() === "+ 添加一组")!.attributes("disabled")).toBeDefined();
    await click(wrapper, "生成全部"); await flushPromises();
    expect(execute.mock.calls.map(call => call[0].id)).toEqual(["first", "case-2"]);
    expect(initial[0]?.params.month).toBe("2026-10"); expect((inputs[0]!.element as HTMLInputElement).value).toBe("2026-10");
    expect(wrapper.findAll(".mr-batch__receipt")[0]!.text()).toContain("未返回可打开的实例标识");
    wrapper.unmount();
  });
  it("cancels queued cases and preserves an already committed success when the active host ignores cancellation", async () => {
    let complete!: (value: ReportBatchReceipt) => void;
    const execute = vi.fn((_item: ReportBatchCase, _context: { signal: AbortSignal }) => new Promise<ReportBatchReceipt>(resolve => { complete = resolve; }));
    const wrapper = mount(ReportBatchPanel, { props: { execute, paramDefs: defs, initialCases: cases(), concurrency: 1 } });
    await click(wrapper, "生成全部"); await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await click(wrapper, "取消剩余任务"); expect(execute.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(wrapper.findAll("button").find(button => button.text() === "正在取消…")!.attributes("disabled")).toBeDefined();
    complete({ instanceId: "committed" }); await flushPromises();
    expect(execute).toHaveBeenCalledTimes(1); expect(wrapper.findAll(".mr-batch__row.is-completed")).toHaveLength(1);
    expect(wrapper.findAll(".mr-batch__row.is-cancelled")).toHaveLength(1); expect(wrapper.get(".mr-batch__progress").text()).toContain("取消 1"); wrapper.unmount();
  });
  it("aborts on configuration replacement/unmount, avoids mixed callbacks and bounds receipts", async () => {
    let release!: (value: ReportBatchReceipt) => void;
    const execute = vi.fn((_item: ReportBatchCase, _context: { signal: AbortSignal }) => new Promise<ReportBatchReceipt>(resolve => { release = resolve; }));
    const wrapper = mount(ReportBatchPanel, { props: { execute, paramDefs: defs, initialCases: cases(), concurrency: 1 } });
    await click(wrapper, "生成全部"); const replacement = vi.fn(async () => ({ instanceId: "new" }));
    await wrapper.setProps({ execute: replacement }); expect(execute.mock.calls[0]?.[1].signal.aborted).toBe(true);
    release({ instanceId: "x".repeat(513), label: "y".repeat(2000), payload: new Uint8Array(100_000) } as ReportBatchReceipt);
    await flushPromises(); expect(replacement).not.toHaveBeenCalled();
    expect(wrapper.get(".mr-batch__receipt span").text()).toHaveLength(512); expect(wrapper.find(".mr-batch__receipt button").exists()).toBe(false);
    expect(wrapper.get(".mr-batch__error").text()).toContain("配置已变更");
    await wrapper.setProps({ execute }); await click(wrapper, "生成全部");
    wrapper.unmount(); expect(execute.mock.calls.at(-1)?.[1].signal.aborted).toBe(true); release({ instanceId: "late" }); await flushPromises();
    expect(wrapper.emitted("open-instance")).toBeUndefined();
  });
  it("readonly blocks modification and execution while allowing existing receipt navigation", async () => {
    const execute = vi.fn(async () => ({}));
    const wrapper = mount(ReportBatchPanel, { props: { execute, paramDefs: defs, initialCases: cases(), readonly: true } });
    expect(wrapper.findAll('input[type="month"]').every(input => input.attributes("disabled") !== undefined)).toBe(true);
    await click(wrapper, "生成全部"); expect(execute).not.toHaveBeenCalled(); wrapper.unmount();
    const completed = mount(ReportBatchPanel, { props: { execute: async () => ({ instanceId: "saved" }), paramDefs: defs, initialCases: [cases()[0]!] } });
    await click(completed, "生成全部"); await completed.setProps({ readonly: true });
    await click(completed, "打开报表实例"); expect(completed.emitted("open-instance")?.[0]).toEqual([{ instanceId: "saved" }]); completed.unmount();
  });
});
