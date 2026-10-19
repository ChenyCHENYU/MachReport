import { onBeforeUnmount, watch, type Ref } from "vue";
import type { TemplateComponent, TemplatePage } from "@agile-team/mach-report";
import { canvasSnapMarks, snapCanvasAxis } from "./canvas-snap";
import {
  componentGeometry,
  constrainGeometry,
  type CanvasGeometry,
} from "./canvas-commands";

interface PointerOptions {
  scale: Ref<number>;
  page: () => TemplatePage;
  disabled: () => boolean;
  commit: (geometry: CanvasGeometry) => void;
}
/** pointermove 不写入模板、不生成历史、不重新分页；每帧仅更新当前节点的 CSS。 */
export function useCanvasPointer(options: PointerOptions) {
  let cancel: (() => void) | undefined;
  function start(
    event: PointerEvent,
    component: TemplateComponent,
    resize = false,
  ): void {
    if (options.disabled() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cancel?.();
    const target = (event.currentTarget as HTMLElement).closest<HTMLElement>(
      "[data-canvas-component]",
    )!;
    const initial = componentGeometry(component),
      startX = event.clientX,
      startY = event.clientY;
    let next = initial,
      frame = 0;
    const scale = options.scale.value;
    const paper = target.parentElement!;
    let guideX: number | undefined, guideY: number | undefined;
    const guides = () => {
      for (const [axis, guide] of [
        ["x", guideX],
        ["y", guideY],
      ] as const) {
        paper.style.setProperty(
          `--mr-canvas-guide-${axis}-display`,
          guide === undefined ? "none" : "block",
        );
        if (guide !== undefined)
          paper.style.setProperty(
            `--mr-canvas-guide-${axis}`,
            `${guide * scale}px`,
          );
      }
    };
    const render = () => {
      frame = 0;
      guides();
      target.style.left = `${next.leftMm * scale}px`;
      target.style.top = `${next.topMm * scale}px`;
      target.style.width = `${next.widthMm * scale}px`;
      target.style.height = `${next.heightMm * scale}px`;
    };
    const marks = {
      leftMm: canvasSnapMarks(options.page().components, component, "leftMm"),
      topMm: canvasSnapMarks(options.page().components, component, "topMm"),
    };
    const move = (moveEvent: PointerEvent) => {
      const x = (moveEvent.clientX - startX) / scale,
        y = (moveEvent.clientY - startY) / scale;
      const horizontal = snapCanvasAxis(
          initial.leftMm + x,
          initial.widthMm,
          marks.leftMm,
          5 / scale,
        ),
        vertical = snapCanvasAxis(
          initial.topMm + y,
          initial.heightMm,
          marks.topMm,
          5 / scale,
        );
      guideX = resize ? undefined : horizontal.guide;
      guideY = resize ? undefined : vertical.guide;
      next = constrainGeometry(
        resize
          ? {
              ...initial,
              widthMm: Math.round((initial.widthMm + x) * 2) / 2,
              heightMm: Math.round((initial.heightMm + y) * 2) / 2,
            }
          : { ...initial, leftMm: horizontal.value, topMm: vertical.value },
        options.page(),
        component.kind === "list",
      );
      if (!frame) frame = requestAnimationFrame(render);
    };
    const stop = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("keydown", keyboard);
      if (frame) cancelAnimationFrame(frame);
      next = commit ? next : initial;
      guideX = undefined;
      guideY = undefined;
      render();
      cancel = undefined;
      if (commit && JSON.stringify(next) !== JSON.stringify(initial))
        options.commit(next);
    };
    const finish = () => stop(true),
      abort = () => stop(false);
    const keyboard = (key: KeyboardEvent) => {
      if (key.key === "Escape") {
        key.preventDefault();
        abort();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("keydown", keyboard);
    cancel = abort;
  }
  watch(options.disabled, (disabled) => {
    if (disabled) cancel?.();
  });
  watch(options.page, () => cancel?.());
  onBeforeUnmount(() => cancel?.());
  return { start };
}
