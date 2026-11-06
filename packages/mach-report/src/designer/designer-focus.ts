/** Focus only package-owned control anchors, opening their existing disclosure ancestors. */
export function focusDesignerControl(root: HTMLElement | undefined | null, key?: string): boolean {
  if (!root) return false;
  const anchor = key && /^[\w-]+$/.test(key) ? root.querySelector<HTMLElement>(`[data-mr-control="${key}"]`) : undefined;
  const nested = anchor?.querySelector<HTMLElement>("input,select,textarea,button");
  const direct = anchor?.matches("input,select,textarea,button") ? anchor : nested;
  const target = direct ?? root.querySelector<HTMLElement>("input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)");
  for (let element = target?.parentElement; element && element !== root; element = element.parentElement)
    if (element instanceof HTMLDetailsElement) element.open = true;
  target?.focus({ preventScroll: true });
  target?.scrollIntoView?.({ block: "nearest" });
  return !!direct;
}
