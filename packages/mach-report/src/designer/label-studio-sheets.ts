import type { ReportTemplate } from "@agile-team/mach-report";

/** Physical millimetres; the label size is never scaled to fill a sheet. */
export function labelStudioSheetLayout(template: ReportTemplate) {
  const first = template.pages[0];
  if (!first || template.pages.some(page => page.layout === "wide" || page.widthMm !== first.widthMm || page.heightMm !== first.heightMm)) return;
  const columns = Math.floor((210 - 24 + 4) / (first.widthMm + 4));
  const rows = Math.floor((297 - 24 + 4) / (first.heightMm + 4));
  if (columns < 1 || rows < 1 || columns * rows > 1000) return;
  return { paper: "a4" as const, columns, rows, marginMm: 12, gapMm: 4, capacity: columns * rows };
}
