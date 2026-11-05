import type { AssetRenderOptions, ComponentImageRenderer } from "@agile-team/mach-report";
import { assertOutputActive } from "../output/progress";

type CodeRenderers = ReturnType<typeof import("@agile-team/mach-report/codes")["createCodeAssetRenderers"]>;
/** Import the encoder only when preview/output actually needs a code image. One instance retains its bounded cache. */
export function createLazyLabelCodeAssets(): AssetRenderOptions {
  let pending: Promise<CodeRenderers> | undefined;
  const load = () => pending ??= import("@agile-team/mach-report/codes").then(module => module.createCodeAssetRenderers()).catch(cause => { pending = undefined; throw cause; });
  const renderer = (kind: keyof CodeRenderers): ComponentImageRenderer => async context => {
    assertOutputActive(context.signal);
    const renderers = await load();
    assertOutputActive(context.signal);
    return renderers[kind](context);
  };
  return { assetRenderers: { barcode: renderer("barcode"), qrcode: renderer("qrcode") } };
}
