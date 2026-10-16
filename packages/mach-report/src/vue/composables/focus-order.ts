/** Use document order at grid boundaries, including Safari configurations that skip buttons. */
export function focusAdjacentControl(current: HTMLElement, backwards: boolean): boolean {
  const candidates = [...current.ownerDocument.querySelectorAll<HTMLElement>("a[href],button,input,textarea,select,[tabindex]:not([tabindex='-1'])")]
    .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled,[hidden],input[type='hidden']") && !element.closest("[inert],[aria-hidden='true']") && element.getClientRects().length > 0)
    .map((element, order) => ({ element, order }))
    .sort((a, b) => (a.element.tabIndex || Infinity) - (b.element.tabIndex || Infinity) || a.order - b.order);
  const index = candidates.findIndex(({ element }) => element === current);
  if (index < 0) return false;
  const target = candidates[index + (backwards ? -1 : 1)]?.element;
  if (!target) return false;
  target.focus();
  return current.ownerDocument.activeElement === target;
}
