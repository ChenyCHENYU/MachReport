import { parseImportRange } from "./import-range";
import type { ImportWarnings, ResolvedImportOptions } from "./import-types";
import { assertOutputActive, waitForOutput, outputCheckpoint, type OutputTaskOptions } from "../output/progress";

export interface CheckedZipEntry { name: string; start: number; compressed: number; method: number }

interface XmlBudget { cells: number; rows: number; mergedCells: number; styles: number; strings: number }

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
}

function checkCoordinate(reference: string, options: ResolvedImportOptions): void {
  const range = parseImportRange(reference);
  if (range.bottom > options.limits.maxRows || range.right > options.limits.maxColumns) {
    throw new Error(`Excel 源文件坐标 ${reference} 超过加载行列上限；请先裁剪工作簿或显式提高 limits`);
  }
}

function checkSheetTag(tag: string, options: ResolvedImportOptions, budget: XmlBudget): void {
  const kind = /^<(?:\w+:)?(\w+)\b/.exec(tag)?.[1];
  if (kind === "c") {
    const reference = attribute(tag, "r");
    if (reference) checkCoordinate(reference, options);
    // Source workbook allocation has a fixed ceiling even when only a small output range is selected.
    if (++budget.cells > 1_000_000) throw new Error("Excel 源文件超过 100 万个单元格的加载上限，请先裁剪工作簿");
  } else if (kind === "row") {
    if (++budget.rows > 1_000_000) throw new Error("Excel 源文件超过 100 万行的加载上限，请先裁剪工作簿");
    const row = attribute(tag, "r");
    if (row && (!/^\d+$/.test(row) || Number(row) < 1 || Number(row) > options.limits.maxRows)) throw new Error("Excel 源文件行坐标超过加载上限，请先裁剪工作簿或提高 limits.maxRows");
  } else if (kind === "mergeCell") {
    const reference = attribute(tag, "ref");
    if (!reference) throw new Error("Excel 合并单元格缺少范围");
    checkCoordinate(reference, options);
    const range = parseImportRange(reference);
    const count = (range.bottom - range.top + 1) * (range.right - range.left + 1);
    budget.mergedCells += count;
    if (range.bottom - range.top + 1 > 200 || budget.mergedCells > 1_000_000) throw new Error("Excel 合并区域超过安全加载上限，请先拆分合并区域");
  } else if (kind === "dimension") {
    const reference = attribute(tag, "ref");
    // Dimensions alone do not allocate cells in ExcelJS; still reject invalid OOXML coordinates.
    if (reference) parseImportRange(reference);
  }
}

function warnDrawingTag(tag: string, warnings: ImportWarnings): void {
  if (/^<(?:\w+:)?srcRect\b/.test(tag) && ["l", "t", "r", "b"].some(key => Number(attribute(tag, key) ?? 0) !== 0)) warnings.add("Excel 图片裁剪暂不还原，导入保留完整图片；请在源文件中将裁剪结果保存为 PNG/JPEG");
  if (/^<(?:\w+:)?xfrm\b/.test(tag) && (Number(attribute(tag, "rot") ?? 0) !== 0 || ["flipH", "flipV"].some(key => ["1", "true"].includes(attribute(tag, key) ?? "")))) warnings.add("Excel 图片旋转或翻转暂不还原，请先在源文件中保存变换后的 PNG/JPEG");
  if (/^<(?:\w+:)?blip\b/.test(tag) && /\blink\s*=/.test(tag)) warnings.add("Excel 外部图片链接不会访问或下载，请嵌入 PNG/JPEG 图片");
  if (/^<(?:\w+:)?(?:sp|cxnSp)\b/.test(tag)) warnings.add("Excel 绘图形状与连接线暂不导入；可在源文件中转换为 PNG/JPEG");
}

function xmlScanner(options: ResolvedImportOptions, budget: XmlBudget, sheet: boolean, styles: boolean, strings: boolean, drawings?: ImportWarnings): (text: string, final?: boolean) => void {
  let pending = "";
  return (text, final = false) => {
    pending += text;
    if (/<!DOCTYPE|<!ENTITY/i.test(pending)) throw new Error("Excel XML 不允许外部实体或 DTD");
    const tags = /<[^>]*>/g;
    let match: RegExpExecArray | null;
    let consumed = 0;
    while ((match = tags.exec(pending))) {
      if (sheet) checkSheetTag(match[0], options, budget);
      if (drawings) warnDrawingTag(match[0], drawings);
      if (styles && /^<(?:\w+:)?xf\b/.test(match[0]) && ++budget.styles > 131_072) throw new Error("Excel 样式数量超过安全加载上限");
      if (strings && /^<(?:\w+:)?si\b/.test(match[0]) && ++budget.strings > 1_000_000) throw new Error("Excel 共享字符串数量超过安全加载上限");
      consumed = tags.lastIndex;
    }
    const lastOpen = pending.lastIndexOf("<");
    pending = lastOpen >= consumed ? pending.slice(lastOpen) : "";
    if (pending.length > 65_536) throw new Error("Excel XML 标签长度异常");
    if (final && pending) throw new Error("Excel XML 标签不完整");
  };
}

function inflatedStream(bytes: Uint8Array, entry: CheckedZipEntry): ReadableStream<Uint8Array> {
  const part = bytes.slice(entry.start, entry.start + entry.compressed);
  const stream = new Blob([part.buffer]).stream();
  if (entry.method === 0) return stream;
  try { return stream.pipeThrough(new DecompressionStream("deflate-raw")); }
  catch { throw new Error("当前环境不支持安全 Excel 解压；请使用支持 DecompressionStream deflate-raw 的现代浏览器或 Node.js 22+"); }
}

/** Count actual streamed bytes, never trust ZIP directory sizes or inflate an unbounded entry. */
export async function preflightExcelEntries(bytes: Uint8Array, entries: CheckedZipEntry[], options: ResolvedImportOptions, task: OutputTaskOptions = {}, warnings?: ImportWarnings): Promise<void> {
  let total = 0;
  const budget: XmlBudget = { cells: 0, rows: 0, mergedCells: 0, styles: 0, strings: 0 };
  const worksheets = entries.filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name));
  if (worksheets.length > options.limits.maxSheets) throw new Error("Excel 工作表数量超过导入上限");
  for (const [entryIndex, entry] of entries.entries()) {
    assertOutputActive(task.signal);
    const reader = inflatedStream(bytes, entry).getReader();
    const cancel = () => { void reader.cancel(task.signal?.reason).catch(() => undefined); };
    task.signal?.addEventListener("abort", cancel, { once: true });
    if (task.signal?.aborted) cancel();
    const worksheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name);
    const scan = /\.xml$/i.test(entry.name) ? xmlScanner(options, budget, worksheet, entry.name === "xl/styles.xml", entry.name === "xl/sharedStrings.xml", /^xl\/drawings\/[^/]+\.xml$/i.test(entry.name) ? warnings : undefined) : undefined;
    const decoder = scan ? new TextDecoder("utf-8", { fatal: true }) : undefined;
    let chunks = 0;
    try {
      while (true) {
        const chunk = await waitForOutput(reader.read(), task.signal);
        assertOutputActive(task.signal);
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > options.limits.maxUncompressedBytes) throw new Error("Excel 实际解压内容超过导入大小上限");
        if (scan && decoder) scan(decoder.decode(chunk.value, { stream: true }));
        if (++chunks % 16 === 0) await outputCheckpoint({ signal: task.signal }, chunks, chunks);
      }
      if (scan && decoder) scan(decoder.decode(), true);
    } finally {
      task.signal?.removeEventListener("abort", cancel);
      // A custom stream may never settle cancel(); cancellation must still release our waiter.
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    await outputCheckpoint({ signal: task.signal }, entryIndex + 1, entries.length);
  }
}
