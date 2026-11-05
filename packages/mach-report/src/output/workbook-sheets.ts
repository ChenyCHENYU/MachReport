/** 可序列化的附加工作表在编码前写入，浏览器与 Worker 共用同一声明。 */
export interface XlsxAdditionalSheet {
  name: string;
  rows: readonly (readonly (string | number | boolean | null)[])[];
  columnWidths?: readonly number[];
}

function checkedSheetName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 31 || /[\\/*?:[\]]/.test(value) || /^'|'$/.test(value)) throw new TypeError("工作表名称无效");
  return value;
}
export function snapshotSheetNames(input?: readonly string[]): string[] | undefined {
  if (input === undefined) return;
  if (!Array.isArray(input) || input.length > 10_000) throw new RangeError("工作表名称列表最多 10000 项");
  return Array.from(input, checkedSheetName);
}

function snapshotRow(row: XlsxAdditionalSheet["rows"][number]): (string | number | boolean | null)[] {
  if (!Array.isArray(row) || row.length > 16_384) throw new TypeError("附加工作表行应为最多 16384 列的标量数组");
  return Array.from(row, value => {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.length <= 32_767 && value.split("\n").length <= 254) return value;
    throw new TypeError("附加工作表仅接受 Excel 范围内的文本、有限数值、布尔或空值");
  });
}

/** 捕获调用方数据，限制附加内容总量，防止异步执行期间修改或绕过主体预算。 */
export function snapshotAdditionalSheets(input?: readonly XlsxAdditionalSheet[]): XlsxAdditionalSheet[] | undefined {
  if (input === undefined) return;
  if (!Array.isArray(input) || input.length > 100) throw new RangeError("附加工作表最多 100 张");
  let cells = 0, characters = 0, rowCount = 0;
  const names = new Set<string>();
  return Array.from(input, (sheet: XlsxAdditionalSheet) => {
    if (!sheet) throw new TypeError("附加工作表声明无效");
    const name = checkedSheetName(sheet.name);
    const key = name.toLowerCase();
    if (names.has(key)) throw new TypeError(`附加工作表名称重复 ${sheet.name}`);
    names.add(key);
    if (!Array.isArray(sheet.rows) || sheet.rows.length > 100_000) throw new RangeError("附加工作表最多 100000 行");
    rowCount += sheet.rows.length;
    if (rowCount > 100_000) throw new RangeError("附加工作表总行数超过 100000");
    const rows = Array.from(sheet.rows, row => {
      const copy = snapshotRow(row);
      cells += copy.length;
      if (cells > 100_000) throw new RangeError("附加工作表总单元格超过 100000");
      for (const value of copy) if (typeof value === "string") characters += value.length;
      if (characters > 4_000_000) throw new RangeError("附加工作表文本超过 4000000 字符");
      return copy;
    });
    const widths = sheet.columnWidths;
    if (widths && (!Array.isArray(widths) || widths.length > 16_384 || Array.from(widths).some(width => !Number.isFinite(width) || width <= 0 || width > 255))) throw new RangeError("附加工作表列宽应在 0 到 255 之间");
    return { name: sheet.name, rows, ...(widths ? { columnWidths: [...widths] } : {}) };
  });
}
