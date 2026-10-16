/** TSV with Excel-compatible quoting; quoted line breaks remain inside their cells. */
export function formatReportClipboard(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map((value) => /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value).join("\t")).join("\r\n");
}
function removeTrailingRow(rows: string[][], text: string): void {
  const last = rows[rows.length - 1];
  if (rows.length > 1 && last?.length === 1 && last[0] === "" && /[\r\n]$/.test(text)) rows.pop();
}

/** Bounded parser for clipboard data; invalid quotes are rejected before edits are built. */
export function parseReportClipboard(text: string, maxCells = 10_000): string[][] {
  if (text.length > 4 * 1024 * 1024) throw new Error("Clipboard text limit exceeded");
  const rows: string[][] = [[]];
  let value = "";
  let quoted = false;
  let afterQuote = false;
  let count = 0;
  function cell(): void {
    if (++count > maxCells) throw new Error("Clipboard cell limit exceeded");
    rows[rows.length - 1]!.push(value);
    value = "";
    afterQuote = false;
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char !== '"') { value += char; continue; }
      if (text[index + 1] === '"') { value += '"'; index++; continue; }
      quoted = false; afterQuote = true; continue;
    }
    if (char === '"' && !value && !afterQuote) { quoted = true; continue; }
    if (char === "\t") { cell(); continue; }
    if (char === "\r" || char === "\n") {
      cell(); rows.push([]);
      if (char === "\r" && text[index + 1] === "\n") index++;
      continue;
    }
    if (afterQuote) throw new Error("Invalid quoted clipboard value");
    value += char;
  }
  if (quoted) throw new Error("Unclosed clipboard quote");
  cell();
  removeTrailingRow(rows, text);
  return rows;
}
