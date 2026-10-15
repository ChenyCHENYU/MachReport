import { parseImportRange } from "./import-range";
import type { ResolvedImportOptions } from "./import-types";

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

function xmlScanner(options: ResolvedImportOptions, budget: XmlBudget, sheet: boolean, styles: boolean, strings: boolean): (text: string, final?: boolean) => void {
  let pending = "";
  return (text, final = false) => {
    pending += text;
    if (/<!DOCTYPE|<!ENTITY/i.test(pending)) throw new Error("Excel XML 不允许外部实体或 DTD");
    const tags = /<[^>]*>/g;
    let match: RegExpExecArray | null;
    let consumed = 0;
    while ((match = tags.exec(pending))) {
      if (sheet) checkSheetTag(match[0], options, budget);
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
export async function preflightExcelEntries(bytes: Uint8Array, entries: CheckedZipEntry[], options: ResolvedImportOptions): Promise<void> {
  let total = 0;
  const budget: XmlBudget = { cells: 0, rows: 0, mergedCells: 0, styles: 0, strings: 0 };
  const worksheets = entries.filter((entry) => /^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name));
  if (worksheets.length > options.limits.maxSheets) throw new Error("Excel 工作表数量超过导入上限");
  for (const entry of entries) {
    const reader = inflatedStream(bytes, entry).getReader();
    const worksheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name);
    const scan = /\.xml$/i.test(entry.name) ? xmlScanner(options, budget, worksheet, entry.name === "xl/styles.xml", entry.name === "xl/sharedStrings.xml") : undefined;
    const decoder = scan ? new TextDecoder("utf-8", { fatal: true }) : undefined;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > options.limits.maxUncompressedBytes) throw new Error("Excel 实际解压内容超过导入大小上限");
        if (scan && decoder) scan(decoder.decode(chunk.value, { stream: true }));
      }
      if (scan && decoder) scan(decoder.decode(), true);
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
