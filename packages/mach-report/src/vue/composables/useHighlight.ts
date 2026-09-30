/**
 * 预览内文本高亮（搜索命中标记）：
 * - highlightTextNodes：TreeWalker 找文本节点，命中片段包 <mark class="mrp-hit">
 * - clearHighlights：拆包还原（避免重复高亮叠加）
 * 纯 DOM 操作，虚拟化窗口外的页不处理（随窗口重建自然清理）。
 */

const HIT_CLASS = "mrp-hit";

export function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll(`mark.${HIT_CLASS}`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  });
}

export function highlightTextNodes(root: HTMLElement, query: string): number {
  const q = query.trim();
  if (!q) return 0;
  const lower = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      // 跳过已有标记与脚本样式
      if (!parent || parent.closest("mark") || /^(SCRIPT|STYLE)$/.test(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return (node.nodeValue ?? "").toLowerCase().includes(lower)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });

  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text);

  let count = 0;
  for (const node of targets) {
    const text = node.nodeValue ?? "";
    const lowerText = text.toLowerCase();
    const parent = node.parentElement;
    if (!parent) continue;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    let idx = lowerText.indexOf(lower);
    while (idx >= 0) {
      if (idx > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
      const mark = document.createElement("mark");
      mark.className = HIT_CLASS;
      mark.textContent = text.slice(idx, idx + q.length);
      frag.appendChild(mark);
      count++;
      cursor = idx + q.length;
      idx = lowerText.indexOf(lower, cursor);
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    parent.replaceChild(frag, node);
  }
  return count;
}
