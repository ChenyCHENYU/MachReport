import type { TemplateEditorController } from "./useTemplateEditor";

/** Native text undo stays with its input. Canvas commands only consume handled shortcuts. */
export function useDesignerShortcuts(read: () => Pick<TemplateEditorController, "undo" | "redo" | "canUndo" | "canRedo" | "blocked">) {
  function keydown(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || !(event.metaKey || event.ctrlKey)) return false;
    const target = event.target;
    if (target instanceof Element && target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"]')) return false;
    const key = event.key.toLowerCase();
    const redo = (key === "z" && event.shiftKey) || key === "y";
    if (key !== "z" && key !== "y") return false;
    const controller = read();
    if (controller.blocked) return false;
    const action = redo ? controller.redo : controller.undo;
    if (!action || !(redo ? controller.canRedo : controller.canUndo)) return false;
    event.preventDefault();
    event.stopPropagation();
    action();
    return true;
  }
  return { keydown };
}
