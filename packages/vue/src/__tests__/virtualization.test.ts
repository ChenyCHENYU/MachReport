import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ReportPreview from "../ReportPreview.vue";
import { createLocalFetcher } from "../local-adapter";
import type { ReportTemplate } from "@agile-team/core";

const tpl: ReportTemplate = {
  pages: [
    {
      widthMm: 210,
      heightMm: 297,
      marginTopMm: 10,
      components: [
        {
          kind: "list",
          leftMm: 10,
          topMm: 10,
          widthMm: 190,
          dataset: "rows",
          fontSizePt: 10,
          columns: [
            { header: "序号", field: "no", widthMm: 40 },
            { header: "名称", field: "name", widthMm: 150 }
          ]
        }
      ]
    }
  ]
};

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ no: String(i + 1), name: `行-${i + 1}` }));
}

describe("视口虚拟化", () => {
  it("200 页计划只挂载窗口内页 + 上下占位", async () => {
    const fetcher = createLocalFetcher({
      BIG: { tempId: "BIG", template: tpl, datasets: { rows: rows(6000) } }
    });
    const wrapper = mount(ReportPreview, { props: { tempId: "BIG", fetcher } });
    await vi.waitFor(() => {
      expect(wrapper.element.querySelectorAll(".mrp-page-holder").length).toBeGreaterThan(0);
    });
    const holders = wrapper.element.querySelectorAll(".mrp-page-holder");
    expect(holders.length).toBeGreaterThan(0);
    expect(holders.length).toBeLessThan(20);
    expect(wrapper.element.querySelector(".mrp-spacer-bottom")).toBeTruthy();
    const rendered = Number(holders[0]!.dataset.page);
    expect(rendered).toBeLessThanOrEqual(2);
    const toolbar = wrapper.text();
    expect(toolbar).toMatch(/1 \/ \d{2,4}/);
  });

  it("占位高度与页高一致（1122.5px/页 A4@96dpi）", async () => {
    const fetcher = createLocalFetcher({
      P: { tempId: "P", template: tpl, datasets: { rows: rows(300) } }
    });
    const wrapper = mount(ReportPreview, { props: { tempId: "P", fetcher } });
    await vi.waitFor(() =>
      expect(wrapper.element.querySelectorAll(".mrp-page-holder").length).toBeGreaterThan(0)
    );
    const spacer = wrapper.element.querySelector(".mrp-spacer-bottom") as HTMLElement | null;
    expect(spacer).toBeTruthy();
    const h = parseFloat(spacer!.style.height);
    const holdersCount = wrapper.element.querySelectorAll(".mrp-page-holder").length;
    const totalPages = Number(
      (wrapper.text().match(/\/ (\d+)/) ?? [])[1] ?? holdersCount
    );
    const pagesBelow = totalPages - holdersCount;
    expect(pagesBelow).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(1100 * pagesBelow * 0.9);
  });
});
