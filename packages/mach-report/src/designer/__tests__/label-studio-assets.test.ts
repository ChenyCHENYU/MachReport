import { expect, it, vi } from "vitest";
import { createLazyLabelCodeAssets } from "../label-studio-assets";
import type { ComponentImageContext } from "@agile-team/mach-report";
const mocks = vi.hoisted(() => ({ create: vi.fn(() => ({ qrcode: vi.fn(() => "qr"), barcode: vi.fn(() => "bar") })) }));
vi.mock("@agile-team/mach-report/codes", () => ({ createCodeAssetRenderers: mocks.create }));
const context = (signal = new AbortController().signal): ComponentImageContext => ({ component: { kind: "qrcode", text: "001", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 20 }, pageIndex: 0, componentIndex: 0, componentPath: [], signal });
it("defers encoder creation until the first resource request and shares one cache across both code types", async () => {
  const assets = createLazyLabelCodeAssets();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(await assets.assetRenderers!.qrcode!(context())).toBe("qr");
  expect(await assets.assetRenderers!.barcode!(context())).toBe("bar");
  expect(mocks.create).toHaveBeenCalledOnce();
});
it("an already cancelled resource never creates an encoder", async () => {
  mocks.create.mockClear();
  const controller = new AbortController(); controller.abort();
  await expect(createLazyLabelCodeAssets().assetRenderers!.qrcode!(context(controller.signal))).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.create).not.toHaveBeenCalled();
});
