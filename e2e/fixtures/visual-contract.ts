import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

/** Compare actual painted surfaces without OS-dependent glyph rasterization baselines. */
export async function expectPaint(page: Page, target: Locator, color: number[], info: TestInfo, name: string, point = { x: 3, y: 3 }): Promise<void> {
  await expect(target).toBeVisible();
  const screenshot = await target.screenshot({ animations: "disabled", scale: "css" });
  await info.attach(`${name}.png`, { body: screenshot, contentType: "image/png" });
  const painted = await page.evaluate(async ({ encoded, point }) => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    return [...context.getImageData(point.x, point.y, 1, 1).data].slice(0, 3);
  }, { encoded: screenshot.toString("base64"), point });
  expect(painted, `${name}: rendered background must match the reviewed palette`).toEqual(color);
}

export async function expectReadable(target: Locator): Promise<void> {
  const ratio = await target.evaluate(element => {
    const rgba = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const luminance = (values: number[]) => {
      const components = values.slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return components[0]! * 0.2126 + components[1]! * 0.7152 + components[2]! * 0.0722;
    };
    const layers: number[][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) layers.push(rgba(getComputedStyle(node).backgroundColor));
    const painted = layers.reverse().reduce((under, over) => under.map((value, index) => over[index]! * (over[3] ?? 1) + value * (1 - (over[3] ?? 1))), [255, 255, 255]);
    const foreground = luminance(rgba(getComputedStyle(element).color)), background = luminance(painted);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

export async function expectContained(control: Locator, container: Locator): Promise<void> {
  const box = await control.boundingBox(), bounds = await container.boundingBox();
  expect(box).not.toBeNull(); expect(bounds).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
  expect(box!.y).toBeGreaterThanOrEqual(bounds!.y - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
}
