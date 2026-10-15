import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("宿主全局CSS不改变报表几何/字形，合并格与HTML打印回读保持一致", async ({ page }, testInfo) => {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible({ timeout: 10000 });
  const sourceUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
  const result = await page.evaluate(async (sourceUrl) => {
    const { renderPlan } = await import(/* @vite-ignore */ sourceUrl) as typeof import("../packages/mach-report/src/index");
    const plan: import("../packages/mach-report/src/schema/render-plan").RenderPlan = {
      schemaVersion: "host-style-regression", pages: [{ pageWidthMm: 130, pageHeightMm: 120, components: [{
        kind: "rect", leftMm: 10, topMm: 10, widthMm: 100, heightMm: 30,
        style: { fontSize: 12, color: "#123456", borderLeft: false, borderBottom: false },
        grid: { paddingMm: 1, colWidthsMm: [30, 70], rowHeightsMm: [10, 20], cells: [
          [{ text: "合并跨行", rowSpan: 2 }, { text: "right-top", style: { align: "right", bold: true } }],
          [{ text: "下方完整内容", style: { fontSizePx: 18, lineHeight: 1.8, verticalAlign: "top" } }]
        ] }
      }, {
        kind: "text", leftMm: 10, topMm: 45, widthMm: 100, heightMm: 20,
        style: { fontSize: 18, verticalAlign: "bottom", opacity: 0.5, lineHeight: 1.5 },
        richParagraphs: [{ segments: [{ text: "normal " }, { text: "emphasis", style: { color: "#c00", bold: true } }] }]
      }, {
        kind: "text", leftMm: 10, topMm: 70, widthMm: 60, heightMm: 30,
        style: { fontSize: 12, lineHeight: 1.5 }, lines: ["first", "", "last"]
      }, {
        kind: "image", leftMm: 80, topMm: 75, widthMm: 20, heightMm: 10,
        imageData: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='10'%3E%3Crect width='20' height='10' fill='green'/%3E%3C/svg%3E"
      }] }]
    };
    const fixture = document.createElement("section");
    fixture.id = "host-style-fixture";
    fixture.style.cssText = "position:fixed;inset:0;z-index:99999;background:white;overflow:auto";
    document.body.append(fixture);
    const root = renderPlan(plan, document);
    fixture.append(root);
    await Promise.all([...root.querySelectorAll("img")].map((img) => img.decode()));
    const snapshot = (scope: ParentNode) => {
      const paper = scope.querySelector<HTMLElement>(".mr-page")!;
      const origin = paper.getBoundingClientRect();
      return [...paper.querySelectorAll<HTMLElement>(".mr-comp,.mr-grid,.mr-cell,.mr-cell-content,.mr-grid-edge,.mr-text,.mr-line,.mr-paragraph,.mr-segment,.mr-image")].map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { className: node.className, text: node.textContent,
          x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
          font: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight,
          color: style.color, padding: style.padding, border: style.borderWidth, transform: style.transform,
          opacity: style.opacity, textTransform: style.textTransform, letterSpacing: style.letterSpacing,
          maxWidth: style.maxWidth, display: style.display };
      });
    };
    const baseline = snapshot(root);
    const css = document.createElement("style");
    css.textContent = `*{box-sizing:content-box} div{font-family:monospace;font-size:29px;line-height:3;letter-spacing:5px;text-transform:uppercase}
      table{border-spacing:30px;border-collapse:separate;width:300px;table-layout:auto;margin:40px}tr{height:200px}
      td,th{padding:18px;border:6px solid red;vertical-align:bottom;white-space:nowrap;font-size:32px;font-weight:900}
      img{max-width:4px;height:auto;margin:20px}span{font-size:40px;line-height:4;font-weight:900}
      .mr-page{padding:30px;border:8px solid blue;max-width:300px;opacity:.2;transform:scale(.5)}`;
    document.head.append(css);
    const polluted = snapshot(root);
    const table = root.querySelector<HTMLElement>(".mr-grid")!;
    const tableBox = table.getBoundingClientRect();
    const cells = [...root.querySelectorAll<HTMLElement>("td")].map((cell) => {
      const rect = cell.getBoundingClientRect();
      return { x: rect.x - tableBox.x, y: rect.y - tableBox.y, width: rect.width, height: rect.height };
    });
    const image = root.querySelector<HTMLElement>("img")!.getBoundingClientRect();
    const lines = [...root.querySelectorAll<HTMLElement>(".mr-line")].map((line) => line.getBoundingClientRect().height);
    const template = document.createElement("template");
    template.innerHTML = root.outerHTML;
    const serialized = template.content.firstElementChild!;
    // HTML export/print reparses the generated markup. Keep the comparison under the same host CSS.
    fixture.append(serialized);
    const roundTrip = snapshot(serialized);
    const edgeCount = serialized.querySelectorAll(".mr-grid-edge").length;
    const tableEdgeCount = serialized.querySelectorAll("table .mr-grid-edge").length;
    const cellCount = serialized.querySelectorAll("table > tbody > tr > td").length;
    serialized.remove();
    css.remove();
    return { baseline, polluted, roundTrip, cells, edgeCount, tableEdgeCount, cellCount,
      rowSpan: root.querySelector<HTMLTableCellElement>("td")!.rowSpan,
      tableWidth: tableBox.width, tableHeight: tableBox.height, imageWidth: image.width, imageHeight: image.height, lines };
  }, sourceUrl);
  expect(result.polluted).toEqual(result.baseline);
  expect(result.roundTrip).toEqual(result.baseline);
  expect(result.cellCount).toBe(3);
  expect(result.rowSpan).toBe(2);
  expect(result.edgeCount).toBe(4);
  expect(result.tableEdgeCount).toBe(0);
  const px = (mm: number) => mm * 96 / 25.4;
  expect(result.tableWidth).toBeCloseTo(px(100), 1);
  expect(result.tableHeight).toBeCloseTo(px(30), 1);
  expect(result.cells[0]!.height).toBeCloseTo(px(30), 1);
  expect(result.cells[2]!.x).toBeCloseTo(px(30), 1);
  expect(result.cells[2]!.y).toBeCloseTo(px(10), 1);
  expect(result.cells[2]!.width).toBeCloseTo(px(70), 1);
  expect(result.imageWidth).toBeCloseTo(px(20), 1);
  expect(result.imageHeight).toBeCloseTo(px(10), 1);
  expect(result.lines).toEqual([24, 24, 24]);
  const inherited = result.baseline.find((node) => node.className === "mr-segment" && node.text === "emphasis")!;
  expect(inherited.size).toBe("24px");
  expect(inherited.weight).toBe("700");
  const right = result.baseline.find((node) => node.className === "mr-cell" && node.text === "right-top")!;
  expect(right.size).toBe("16px");
  await testInfo.attach("host-style-geometries.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  await testInfo.attach("host-style-preview.png", { body: await page.screenshot(), contentType: "image/png" });
});
