import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate, type ReportTemplateCatalogProvider } from "../../index";
import ReportTemplateLibrary from "../ReportTemplateLibrary.vue";
function document(id = "daily", revision = "3") { return defineReportTemplate({ id, name: "生产日报", revision, template: createTableTemplate({ columns: [{ field: "a", header: "A" }] }) }); }
function button(wrapper: ReturnType<typeof mount>, name: string) { return wrapper.findAll("button").find(item => item.text() === name)!; }
describe("template library lifecycle and operation recovery", () => {
  it("passes distinct editing and published intents while preserving legacy providers", async () => {
    const get = vi.fn(async (_id: string, context: { mode?: string }) => document("daily", context.mode === "published" ? "2" : "3"));
    const wrapper = mount(ReportTemplateLibrary, { props: { provider: { get, search: async () => ({ items: [{ ...document(), draftRevision: "3", publishedRevision: "2" }] }) } } });
    await flushPromises(); expect(wrapper.text()).toContain("草稿待发布");
    await button(wrapper, "继续编辑草稿").trigger("click"); await flushPromises();
    expect(wrapper.emitted("open")?.[0]).toEqual([document(), { mode: "edit" }]);
    await button(wrapper, "查看发布版").trigger("click"); await flushPromises();
    expect(wrapper.emitted("open")?.[1]).toEqual([document("daily", "2"), { mode: "published" }]); wrapper.unmount();
  });
  it("refuses a draft returned by a legacy provider when explicitly viewing a published revision", async () => {
    const wrapper = mount(ReportTemplateLibrary, { props: { provider: { get: async () => document(), search: async () => ({ items: [{ ...document(), publishedRevision: "2" }] }) } } });
    await flushPromises(); await button(wrapper, "查看发布版").trigger("click"); await flushPromises();
    expect(wrapper.emitted("open")).toBeUndefined(); expect(wrapper.get('[role="alert"]').text()).toContain("发布修订与目录不一致"); wrapper.unmount();
  });
  it("retries a failed open rather than issuing another directory search", async () => {
    const search = vi.fn(async () => ({ items: [document()] }));
    const get = vi.fn().mockRejectedValueOnce(new Error("读取暂时失败")).mockResolvedValue(document());
    const wrapper = mount(ReportTemplateLibrary, { props: { provider: { search, get } } }); await flushPromises();
    await button(wrapper, "打开设计器").trigger("click"); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("读取暂时失败");
    await button(wrapper, "重试打开模板").trigger("click"); await flushPromises();
    expect(search).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(2); expect(wrapper.emitted("open")).toHaveLength(1); wrapper.unmount();
  });
  it("retries the same isolated copy candidate after persistence failure", async () => {
    const search = vi.fn(async () => ({ items: [document()] })), get = vi.fn(async () => document());
    const create = vi.fn().mockImplementationOnce(async candidate => { candidate.name = "callback mutation"; throw new Error("写入暂时失败"); }).mockImplementationOnce(async candidate => candidate);
    const wrapper = mount(ReportTemplateLibrary, { props: { provider: { search, get }, create } }); await flushPromises();
    await button(wrapper, "复制模板").trigger("click");
    await wrapper.findAll("form input")[0]!.setValue("copy"); await wrapper.get("form").trigger("submit"); await flushPromises();
    await button(wrapper, "重试创建副本").trigger("click"); await flushPromises();
    expect(get).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted("open")?.[0]?.[0]).toMatchObject({ id: "copy", name: "生产日报" }); wrapper.unmount();
  });
  it("retries the exact failed page and retains the previous cursor history", async () => {
    let failed = false;
    const search: ReportTemplateCatalogProvider["search"] = vi.fn(async request => {
      if (request.cursor === "page2" && !failed) { failed = true; throw new Error("第二页失败"); }
      return { items: [document(request.cursor ? "second" : "first")], next: request.cursor ? undefined : "page2" };
    });
    const wrapper = mount(ReportTemplateLibrary, { props: { provider: { search, get: async () => document() } } }); await flushPromises();
    await button(wrapper, "下一页").trigger("click"); await flushPromises();
    expect(wrapper.text()).toContain("first");
    await button(wrapper, "重试目录查询").trigger("click"); await flushPromises();
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "page2" })); expect(wrapper.text()).toContain("second");
    await button(wrapper, "上一页").trigger("click"); await flushPromises();
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: undefined })); expect(wrapper.text()).toContain("first"); wrapper.unmount();
  });
  it("announces the specific loading target and does not open a stale response after replacement", async () => {
    let resolve!: (value: ReturnType<typeof document>) => void;
    const wrapper = mount(ReportTemplateLibrary, { props: { provider: { search: async () => ({ items: [document()] }), get: () => new Promise(done => { resolve = done; }) } } }); await flushPromises();
    await button(wrapper, "打开设计器").trigger("click"); expect(wrapper.get('[role="status"]').text()).toContain("正在打开 生产日报");
    await wrapper.setProps({ provider: { search: async () => ({ items: [] }), get: async () => undefined } }); resolve(document()); await flushPromises();
    expect(wrapper.emitted("open")).toBeUndefined(); wrapper.unmount();
  });
});
