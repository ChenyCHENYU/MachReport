import { ref } from "vue";

/**
 * 缩放状态（transform: scale 方案）：
 * - fit 模式：按视口宽自适应（clamp 0.3~1）
 * - raw 模式：固定百分比
 * transform 而非 CSS zoom：标准属性、跨浏览器、零重排。
 */
export function useZoom(
  getFitInputs: () => { viewport: HTMLElement | null; pageWidthPx: number } | null
) {
  const zoom = ref(1);
  const zoomMode = ref<"fit" | "raw">("fit");

  function applyFitZoom(): void {
    requestAnimationFrame(() => {
      const inputs = getFitInputs();
      if (!inputs || !inputs.viewport) return;
      zoom.value = Math.min(
        1,
        Math.max(0.3, (inputs.viewport.clientWidth - 48) / Math.max(1, inputs.pageWidthPx))
      );
    });
  }

  function setZoom(mode: "fit" | number): void {
    if (mode === "fit") {
      zoomMode.value = "fit";
      applyFitZoom();
    } else {
      zoomMode.value = "raw";
      zoom.value = mode / 100;
    }
  }

  return { zoom, zoomMode, applyFitZoom, setZoom };
}
