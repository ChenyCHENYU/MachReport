import type { ResolvedImportOptions } from "./import-types";
import { ImportWarnings } from "./import-types";
import { preflightExcelEntries, type CheckedZipEntry } from "./import-preflight";
import { assertOutputActive, waitForOutput, type OutputTaskOptions } from "../output/progress";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function inputBytes(input: ArrayBuffer | Uint8Array | Blob, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  assertOutputActive(signal);
  if (input instanceof Uint8Array) {
    if (input.byteLength > limit) throw new Error("Excel 文件超过导入大小上限");
    // Buffer is a Uint8Array subclass whose slice keeps the original pooled backing store.
    return new Uint8Array(input);
  }
  if (input instanceof ArrayBuffer) {
    if (input.byteLength > limit) throw new Error("Excel 文件超过导入大小上限");
    return new Uint8Array(input.slice(0));
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    if (input.size > limit) throw new Error("Excel 文件超过导入大小上限");
    return new Uint8Array(await waitForOutput(input.arrayBuffer(), signal));
  }
  throw new Error("Excel 导入需要 ArrayBuffer、Uint8Array 或 Blob");
}

function endRecord(view: DataView): number {
  const floor = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= floor; offset--) {
    if (view.getUint32(offset, true) === EOCD && offset + 22 + view.getUint16(offset + 20, true) === view.byteLength) return offset;
  }
  throw new Error("Excel 文件不是完整的 .xlsx ZIP 文件");
}

function centralDirectory(view: DataView, end: number): { start: number; size: number; entries: number } {
  const entries = view.getUint16(end + 10, true);
  const start = view.getUint32(end + 16, true);
  const size = view.getUint32(end + 12, true);
  const disks = view.getUint16(end + 4, true) + view.getUint16(end + 6, true);
  if (disks || view.getUint16(end + 8, true) !== entries || entries === 65_535 || start === 0xffffffff || size === 0xffffffff) {
    throw new Error("不支持分卷或 ZIP64 Excel 文件");
  }
  if (entries < 1 || entries > 2_048 || start + size !== end) throw new Error("Excel ZIP 目录无效或条目过多");
  return { start, size, entries };
}

interface ZipEntry extends CheckedZipEntry { next: number; size: number }

function readEntry(bytes: Uint8Array, view: DataView, offset: number, end: number, directoryStart: number): ZipEntry {
  if (offset + 46 > end || view.getUint32(offset, true) !== CENTRAL) throw new Error("Excel ZIP 条目无效");
  const flags = view.getUint16(offset + 8, true);
  const method = view.getUint16(offset + 10, true);
  const nameSize = view.getUint16(offset + 28, true);
  const next = offset + 46 + nameSize + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  const local = view.getUint32(offset + 42, true);
  const compressed = view.getUint32(offset + 20, true);
  const size = view.getUint32(offset + 24, true);
  if (next > end || local + 30 > bytes.length || flags & 1 || ![0, 8].includes(method)) throw new Error("Excel ZIP 包含无效、加密或不支持的条目");
  if (size === 0xffffffff || compressed === 0xffffffff || view.getUint32(local, true) !== LOCAL) throw new Error("Excel ZIP 本地条目无效");
  const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  if (dataStart + compressed > directoryStart || view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags) throw new Error("Excel ZIP 数据边界或压缩方式无效");
  const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
  if (name.includes("\\") || name.split("/").includes("..") || name.startsWith("/")) throw new Error("Excel ZIP 包含不安全路径");
  return { name, next, size, start: dataStart, compressed, method };
}

function warnEntry(name: string, warnings: ImportWarnings): void {
  if (/^xl\/charts\//.test(name)) warnings.add("Excel 图表对象不作为图片导入；请在源文件中插入 PNG/JPEG 图片以保留静态图表外观");
  if (/^xl\/pivot/.test(name)) warnings.add("Excel 透视表仅导入已保存的单元格结果，不提供交互或重算");
  if (/^xl\/externalLinks\//.test(name)) warnings.add("Excel 外部链接不会访问或刷新，仅使用文件内已保存的结果");
  if (/vbaProject|activeX|embeddings/i.test(name)) warnings.add("Excel 宏、控件与嵌入对象不会执行或导入");
}

/** Check declared allocation sizes before ExcelJS inflates/parses workbook XML. */
export async function checkedExcelBytes(input: ArrayBuffer | Uint8Array | Blob, options: ResolvedImportOptions, warnings: ImportWarnings, task: OutputTaskOptions = {}): Promise<Uint8Array> {
  const bytes = await inputBytes(input, options.limits.maxFileBytes, task.signal);
  assertOutputActive(task.signal);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new Error("Excel 文件为空或格式无效；仅支持 .xlsx");
  const directory = centralDirectory(view, endRecord(view));
  let offset = directory.start;
  let total = 0;
  const names = new Set<string>();
  const entries: CheckedZipEntry[] = [];
  for (let index = 0; index < directory.entries; index++) {
    assertOutputActive(task.signal);
    const entry = readEntry(bytes, view, offset, directory.start + directory.size, directory.start);
    if (names.has(entry.name)) throw new Error("Excel ZIP 条目名称重复");
    names.add(entry.name);
    total += entry.size;
    if (total > options.limits.maxUncompressedBytes) throw new Error("Excel 解压后内容超过导入大小上限");
    warnEntry(entry.name, warnings);
    entries.push(entry);
    offset = entry.next;
  }
  if (offset !== directory.start + directory.size || !names.has("xl/workbook.xml") || !names.has("[Content_Types].xml")) {
    throw new Error("文件不是受支持的 .xlsx 工作簿");
  }
  await preflightExcelEntries(bytes, entries, options, task, warnings);
  return bytes;
}
