import { getCurrentScope, onScopeDispose, ref } from "vue";

/**
 * 缩放状态（transform: scale 方案）：
 * - fit 模式：按视口宽自适应，超宽表也能完整缩入视口
 * - raw 模式：固定百分比（30%~300%）
 * transform 而非 CSS zoom：标准属性、跨浏览器、零重排。
 */
export function useZoom(
  getFitInputs: () => { viewport: HTMLElement | null; pageWidthPx: number } | null
) {
  const zoom = ref(1);
  const zoomMode = ref<"fit" | "raw">("fit");
  let fitRaf = 0;

  function cancelFit(): void {
    if (fitRaf) cancelAnimationFrame(fitRaf);
    fitRaf = 0;
  }

  function applyFitZoom(): void {
    cancelFit();
    fitRaf = requestAnimationFrame(() => {
      fitRaf = 0;
      if (zoomMode.value !== "fit") return;
      const inputs = getFitInputs();
      // 尚未显示的容器不应将报表缩成一条线；显示后由 resize 再计算。
      if (!inputs?.viewport || inputs.viewport.clientWidth <= 48 || !Number.isFinite(inputs.pageWidthPx)) return;
      zoom.value = Math.min(1, (inputs.viewport.clientWidth - 48) / Math.max(1, inputs.pageWidthPx));
    });
  }

  function setZoom(mode: "fit" | number): void {
    if (mode === "fit") {
      zoomMode.value = "fit";
      applyFitZoom();
    } else {
      if (!Number.isFinite(mode)) return;
      cancelFit();
      zoomMode.value = "raw";
      zoom.value = Math.min(3, Math.max(0.3, mode / 100));
    }
  }

  if (getCurrentScope()) onScopeDispose(cancelFit);

  return { zoom, zoomMode, applyFitZoom, setZoom };
}
