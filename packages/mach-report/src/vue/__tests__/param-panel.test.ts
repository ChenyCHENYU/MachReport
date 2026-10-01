 // @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportPreview from "../ReportPreview.vue";
import ReportParamPanel from "../ReportParamPanel.vue";
import type { ReportParamDef } from "@agile-team/mach-report";

const defs: ReportParamDef[] = [
  { field: "whCode", label: "仓库", type: "select", required: true, options: [
    { label: "1号库", value: "W1" },
    { label: "2号库", value: "W2" }
  ] },
  { field: "date", label: "日期", type: "date", defaultValue: "2026-09-30" },
  { field: "keyword", label: "关键字", placeholder: "物料模糊查询" }
];

/** 记录每次 reload 收到的 params（经 fetcher 观测合并结果）；返回 PlanPage 形状（契约） */
function paramsSpy() {
  const seen: Array<Record<string, string>> = [];
  const fetcher = async (input: { params: Record<string, string> }) => {
    seen.push(input.params);
    return {
      schemaVersion: "t",
      pages: [{ pageWidthMm: 210, pageHeightMm: 100, components: [] as never[] }]
    };
  };
  return { seen, fetcher };
}

async function mountPanel(extra: Record<string, unknown> = {}) {
  const { seen, fetcher } = paramsSpy();
  const wrapper = mount(ReportPreview, {
    props: { tempId: "T1", autoLoad: true, fetcher, paramDefs: defs, ...extra },
    attachTo: document.body
  });
  await vi.waitFor(() => {
    expect(wrapper.element.querySelector(".mrp-page-holder")).toBeTruthy();
  }, { timeout: 5000 });
  return { wrapper, seen };
}

describe("参数面板（使用侧零表单代码）", () => {
  it("按 defs 渲染四类控件，默认值就位", async () => {
    const { wrapper } = await mountPanel();
    const panel = wrapper.findComponent(ReportParamPanel);
    expect(panel.exists()).toBe(true);
    expect(wrapper.element.querySelectorAll(".mrp-param").length).toBe(3);
    const dateInput = wrapper.element.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.value).toBe("2026-09-30");
    const select = wrapper.element.querySelector("select") as HTMLSelectElement;
    expect(select.options.length).toBe(3); // placeholder + 2 选项
    wrapper.unmount();
  }, 15000);

  it("初始加载带默认参数；查询把面板值合并进 params", async () => {
    const { wrapper, seen } = await mountPanel();
    // 默认值参与首载
    expect(seen[0]!.date).toBe("2026-09-30");
    // 用户改值 → 查询
    const select = wrapper.element.querySelector("select") as HTMLSelectElement;
    select.value = "W2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const kw = wrapper.element.querySelector('input[placeholder="物料模糊查询"]') as HTMLInputElement;
    kw.value = "钢";
    kw.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50)); // 等 v-model flush 后再查询
    await wrapper.findAll("button").find((b) => b.text().includes("查"))!.trigger("click");
    await vi.waitFor(() => expect(seen.length).toBe(2), { timeout: 5000 });
    expect(seen[1]!.whCode).toBe("W2");
    expect(seen[1]!.keyword).toBe("钢");
    expect(seen[1]!.date).toBe("2026-09-30"); // 未改动保留
    wrapper.unmount();
  }, 15000);

  it("必填缺失：查询被拦截并报 param 错误码（不触发 reload）", async () => {
    const onError = vi.fn();
    const { wrapper, seen } = await mountPanel({ onError });
    const query = wrapper.findAll("button").find((b) => b.text().includes("查"))!;
    await query.trigger("click");
    await vi.waitFor(() => expect(onError).toHaveBeenCalled(), { timeout: 5000 });
    const [msg, detail] = onError.mock.calls[0] as [string, { code: string }];
    expect(msg).toContain("仓库");
    expect(detail.code).toBe("param");
    expect(seen.length).toBe(1); // 未重查
    // 红框提示出现
    expect(wrapper.element.querySelectorAll(".mrp-param-missing").length).toBe(1);
    wrapper.unmount();
  }, 15000);

  it("重置恢复默认值并清除红框", async () => {
    const { wrapper } = await mountPanel();
    const query = wrapper.findAll("button").find((b) => b.text().includes("查"))!;
    await query.trigger("click");
    expect(wrapper.element.querySelectorAll(".mrp-param-missing").length).toBe(1);
    const reset = wrapper.findAll("button").find((b) => b.text().includes("重"))!;
    await reset.trigger("click");
    expect(wrapper.element.querySelectorAll(".mrp-param-missing").length).toBe(0);
    const dateInput = wrapper.element.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.value).toBe("2026-09-30");
    wrapper.unmount();
  }, 15000);

  it("show-params=false 或无 defs 不渲染面板", async () => {
    const a = await mountPanel({ showParams: false });
    expect(a.wrapper.findComponent(ReportParamPanel).exists()).toBe(false);
    a.wrapper.unmount();

    const { seen, fetcher } = paramsSpy();
    const b = mount(ReportPreview, {
      props: { tempId: "T1", autoLoad: true, fetcher } // 无 paramDefs
    });
    await vi.waitFor(() => expect(seen.length).toBe(1), { timeout: 5000 });
    expect(b.findComponent(ReportParamPanel).exists()).toBe(false);
    b.unmount();
  }, 15000);

  it("面板值覆盖宿主 props.params（用户意图优先）", async () => {    const { seen, fetcher } = paramsSpy();
    const wrapper = mount(ReportPreview, {
      props: { tempId: "T1", autoLoad: true, fetcher, paramDefs: defs, params: { keyword: "宿主词" } }
    });
    await vi.waitFor(() => expect(seen.length).toBe(1), { timeout: 5000 });
    expect(seen[0]!.keyword).toBe("宿主词"); // 面板空值不覆盖
    // 必填仓库选上（否则被必填拦截），再改关键字验证覆盖
    const select = wrapper.element.querySelector("select") as HTMLSelectElement;
    select.value = "W1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const kw = wrapper.element.querySelector('input[placeholder="物料模糊查询"]') as HTMLInputElement;
    kw.value = "用户词";
    kw.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50)); // 等 v-model flush 后再查询
    await wrapper.findAll("button").find((x) => x.text().includes("查"))!.trigger("click");
    await vi.waitFor(() => expect(seen.length).toBe(2), { timeout: 5000 });
    expect(seen[1]!.keyword).toBe("用户词");
    wrapper.unmount();
  }, 15000);

  it("setParams 编程式设参查询（面板同步显示新值）", async () => {
    const { wrapper, seen } = await mountPanel();
    (wrapper.vm as unknown as { setParams: (v: Record<string, string>) => void }).setParams({
      whCode: "W1",
      keyword: "程序注入"
    });
    await vi.waitFor(() => expect(seen.length).toBe(2), { timeout: 5000 });
    expect(seen[1]!.whCode).toBe("W1");
    expect(seen[1]!.keyword).toBe("程序注入");
    // 面板下拉同步显示
    const select = wrapper.element.querySelector("select") as HTMLSelectElement;
    await vi.waitFor(() => expect(select.value).toBe("W1"), { timeout: 3000 });
    // reload=false 仅设值不查询
    (wrapper.vm as unknown as { setParams: (v: Record<string, string>, o?: { reload?: boolean }) => void }).setParams(
      { keyword: "静默" },
      { reload: false }
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.length).toBe(2);
    wrapper.unmount();
  }, 15000);
});
