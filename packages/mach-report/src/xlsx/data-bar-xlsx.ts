import type { RenderPlan } from "../schema/render-plan";
import { createOutputScheduler, type OutputTaskOptions } from "../output/progress";
import { encode } from "fast-png";
import type * as ExcelJS from "exceljs";
import type { GridLayout } from "../render/grid-geometry";
import { dataBarBox } from "../render/data-bar";
import type { XlsxImageWriter } from "./image-xlsx";

function colorPixel(color: string): string {
  const bytes = encode({ width: 1, height: 1, channels: 4, depth: 8, data: new Uint8Array([1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)).concat(89)) });
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}
/** Static visual snapshots, shared color media, bounded drawing count. Cell values remain native. */
export function createXlsxDataBarWriter(images: XlsxImageWriter, maximum: number, notes: string[]) {
  const pixels = new Map<string, string>(); let count = 0;
  return (sheet: ExcelJS.Worksheet, cell: GridLayout["cells"][number], row: number, padding: number): void => {
    const box = dataBarBox(cell.cell.dataBar, cell.widthMm, cell.heightMm, padding); if (!box) return;
    if (++count > maximum) throw new Error(`Excel 数据条超过 ${maximum} 个绘图预算，请缩小范围或调整 maxDataBars`);
    let imageData = pixels.get(box.color);
    if (!imageData) { imageData = colorPixel(box.color); pixels.set(box.color, imageData); }
    if (count === 1) notes.push("数据条为静态半透明视觉快照，保留原始单元格值；Excel 编辑不会重算条形，绘图叠加文字的混色与预览可能略有差异。");
    images.write(sheet, { kind: "image", leftMm: 0, topMm: 0, widthMm: box.width, heightMm: box.height, imageData }, row, { leftMm: cell.xMm + box.x, offsetMm: box.y });
  };
}

export async function assertXlsxDataBarBudget(plan: RenderPlan, maximum: number, options: OutputTaskOptions): Promise<void> {
  const stack = plan.pages.flatMap(page => page.components), schedule = createOutputScheduler(options);
  let count = 0;
  while (stack.length) {
    const component = stack.pop()!;
    for (const row of component.grid?.cells ?? []) for (const cell of row) {
      if (cell?.dataBar && cell.dataBar.end > cell.dataBar.start && ++count > maximum) throw new Error(`Excel 数据条超过 ${maximum} 个绘图预算，请缩小范围或调整 maxDataBars`);
      if (cell?.children) stack.push(...cell.children);
      const pause = schedule(); if (pause) await pause;
    }
  }
}
