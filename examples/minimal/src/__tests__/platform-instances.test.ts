import { createApp, nextTick, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportInstanceSummary } from "@agile-team/mach-report/server";
import PlatformDemo from "../PlatformDemo.vue";

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@agile-team/mach-report/server", async importOriginal => {
  const actual = await importOriginal<typeof import("@agile-team/mach-report/server")>();
  return { ...actual, createMemoryReportInstanceStore: () => ({ ...actual.createMemoryReportInstanceStore(), list }) };
});
const items: ReportInstanceSummary[] = Array.from({ length: 21 }, (_, index) => ({
  scope: "local-demo", id: `instance-${index}`, revision: 1, title: `已生成实例 ${index + 1}`,
  generatedAt: "2026-11-05T00:00:00.000Z", reportIds: ["report"], params: {}, templateRevisions: { report: "2" }, sourceRevisions: {},
}));
let app: App | undefined, host: HTMLDivElement;
async function settle() { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); }
async function mountDemo() {
  host = document.createElement("div"); document.body.append(host);
  app = createApp(PlatformDemo); app.mount(host); await settle();
}
async function click(text: string) {
  [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click(); await settle();
}
const count = () => host.querySelectorAll(".platform-instances aside button[aria-pressed]").length;

beforeEach(() => list.mockReset());
afterEach(() => { app?.unmount(); app = undefined; host?.remove(); });

describe("product instance navigation", () => {
  it("follows the store cursor and keeps a failed next page available for retry", async () => {
    list.mockResolvedValueOnce({ items: items.slice(0, 20), next: "page-2" })
      .mockRejectedValueOnce(new Error("暂时无法加载"))
      .mockResolvedValueOnce({ items: items.slice(20) });
    await mountDemo(); await click("报表实例");
    expect(count()).toBe(20);
    await click("加载更多实例");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("暂时无法加载");
    expect(count()).toBe(20);
    await click("加载更多实例");
    expect(list).toHaveBeenLastCalledWith("local-demo", expect.objectContaining({ after: "page-2", limit: 20 }));
    expect(count()).toBe(21);
    expect(host.querySelector(".platform-load-more")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("disables duplicate page requests and cancels a pending read on unmount", async () => {
    let resolve!: (page: { items: ReportInstanceSummary[] }) => void;
    list.mockResolvedValueOnce({ items: items.slice(0, 20), next: "page-2" })
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await mountDemo(); await click("报表实例"); await click("加载更多实例");
    expect((host.querySelector(".platform-load-more") as HTMLButtonElement).disabled).toBe(true);
    const signal = list.mock.calls[1]![1].signal as AbortSignal;
    app!.unmount(); app = undefined; expect(signal.aborted).toBe(true);
    resolve({ items: items.slice(20) }); await settle();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
