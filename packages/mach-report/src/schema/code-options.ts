/** Serializable symbol settings. Encoders remain in the optional /codes entry. */
export interface CodeOptions {
  /** Explicit content, including an empty value, takes precedence over legacy fallbackText. */
  value?: string;
  symbology?: "code128" | "code39" | "ean13" | "ean8";
  errorCorrection?: "L" | "M" | "Q" | "H";
  /** White modules around a symbol: QR >=4, linear >=10, EAN >=11. */
  quietZoneModules?: number;
  /** Human-readable content below a linear barcode. */
  showText?: boolean;
}

export interface CodeOptionIssue { path: string; message: string }

function scalarIssues(code: Record<string, unknown>): CodeOptionIssue[] {
  const issues: CodeOptionIssue[] = [];
  if (code.value !== undefined && typeof code.value !== "string") issues.push({ path: "value", message: "Symbol value must be a string." });
  if (code.symbology !== undefined && !["code128", "code39", "ean13", "ean8"].includes(code.symbology as string)) issues.push({ path: "symbology", message: "Unsupported barcode symbology." });
  if (code.errorCorrection !== undefined && !["L", "M", "Q", "H"].includes(code.errorCorrection as string)) issues.push({ path: "errorCorrection", message: "Unsupported QR error correction." });
  if (code.showText !== undefined && typeof code.showText !== "boolean") issues.push({ path: "showText", message: "showText must be a boolean." });
  return issues;
}

function kindIssues(code: Record<string, unknown>, kind: string): CodeOptionIssue[] {
  const issues: CodeOptionIssue[] = [];
  if (kind !== "barcode" && kind !== "qrcode") issues.push({ path: "", message: "code is only supported by barcode and qrcode components." });
  if (kind === "qrcode" && code.symbology !== undefined) issues.push({ path: "symbology", message: "QR components do not use a linear symbology." });
  if (kind === "qrcode" && code.showText === true) issues.push({ path: "showText", message: "Use a separate text component below a QR code." });
  if (kind === "barcode" && code.errorCorrection !== undefined) issues.push({ path: "errorCorrection", message: "Linear barcodes do not use QR error correction." });
  return issues;
}

/** Pure metadata validation; empty design-time values are validated when rendered. */
export function codeOptionIssues(value: unknown, kind: string): CodeOptionIssue[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [{ path: "", message: "code must be an object." }];
  const code = value as Record<string, unknown>, issues = [...scalarIssues(code), ...kindIssues(code, kind)];
  for (const key of Object.keys(code)) if (!["value", "symbology", "errorCorrection", "quietZoneModules", "showText"].includes(key)) issues.push({ path: key, message: "Unknown symbol option." });
  const ean = code.symbology === "ean13" || code.symbology === "ean8";
  const minimum = kind === "qrcode" ? 4 : ean ? 11 : 10;
  if (code.quietZoneModules !== undefined && (!Number.isSafeInteger(code.quietZoneModules) || Number(code.quietZoneModules) < minimum || Number(code.quietZoneModules) > 64)) issues.push({ path: "quietZoneModules", message: `Quiet zone must contain ${minimum}–64 whole modules.` });
  return issues;
}
