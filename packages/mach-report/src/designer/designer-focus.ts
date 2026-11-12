/** The integer client box must never enlarge a fractional painted clipping box. */
export function visibleScrollBounds(viewport: HTMLElement): { top: number; bottom: number } {
  const bounds = viewport.getBoundingClientRect();
  const top = bounds.top + viewport.clientTop;
  const bottomInset = Math.max(0, viewport.offsetHeight - viewport.clientHeight - viewport.clientTop);
  const bottom = Math.min(bounds.bottom - bottomInset, top + viewport.clientHeight);
  return { top, bottom };
}

/** Flex sizes retain fractions while clientHeight/scrollTop can round in browsers. */
export function revealInScrollContainer(viewport: HTMLElement, target: HTMLElement): void {
  const control = target.getBoundingClientRect(), { top, bottom } = visibleScrollBounds(viewport);
  if (control.top < top) viewport.scrollTop -= Math.ceil(top - control.top);
  else if (control.bottom > bottom) viewport.scrollTop += Math.ceil(control.bottom - bottom);
}

/** Finish native focus scrolling against the actual clipping bounds of scroll ancestors. */
export function revealDesignerTarget(target: HTMLElement | undefined | null): void {
  if (!target) return;
  for (let node = target.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) revealInScrollContainer(node, target);
  }
}

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
  revealDesignerTarget(target);
  return !!direct;
}
