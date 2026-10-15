interface DisplaySection {
  pattern: string;
  magnitude: number;
  negative: boolean;
}

interface ProtectedPattern {
  text: string;
  literals: string[];
}

/** Semicolons inside a quoted or escaped literal do not select another value section. */
function sectionsOf(format: string): string[] {
  const sections = [""];
  let quoted = false;
  let escaped = false;
  for (const char of format) {
    if (char === ";" && !quoted && !escaped) sections.push("");
    else sections[sections.length - 1] += char;
    if (char === '"' && !escaped) quoted = !quoted;
    escaped = char === "\\" && !escaped;
  }
  return sections;
}

function selectSection(value: number, format: string): DisplaySection {
  const sections = sectionsOf(format);
  const index = value === 0 && sections.length > 2 ? 2 : value < 0 && sections.length > 1 ? 1 : 0;
  return { pattern: sections[index]!, magnitude: Math.abs(value), negative: value < 0 && index === 0 };
}

/** Protect quoted digits and symbols before recognizing number-pattern tokens. */
function protectPattern(pattern: string): ProtectedPattern {
  const literals: string[] = [];
  const text = pattern.replace(/"([^"]*)"|\\(.)/g, (_, quoted: string | undefined, escaped: string | undefined) => {
    literals.push(quoted ?? escaped ?? "");
    return String.fromCharCode(0xE000 + literals.length - 1);
  }).replace(/\[(Black|Blue|Cyan|Green|Magenta|Red|White|Yellow|Color\d+)\]/gi, "");
  return { text, literals };
}

function literalText(text: string, pattern: ProtectedPattern): string | null {
  // Conditions, dates, fractions, scaling, accounting spacing and unknown pattern syntax remain explicit fallbacks.
  if (/[0#?@_*%[\]"\\.,/]/.test(text)) return null;
  return text.replace(/[\uE000-\uF8FF]/g, (char) => pattern.literals[char.charCodeAt(0) - 0xE000] ?? "");
}

function scientificNumber(section: DisplaySection, pattern: ProtectedPattern): string | null {
  const match = /^(.*?)(0)(?:\.([0#]+))?E([+-])(0+)(.*?)$/i.exec(pattern.text);
  if (!match) return null;
  const prefix = literalText(match[1]!, pattern);
  const suffix = literalText(match[6]!, pattern);
  const decimals = match[3] ?? "";
  if (prefix === null || suffix === null || decimals.length > 100) return null;
  const [coefficient, exponent] = section.magnitude.toExponential(decimals.length).split("e");
  const minimum = decimals.replace(/#/g, "").length;
  const [integer, fractional = ""] = coefficient!.split(".");
  const trimmed = fractional.replace(/0+$/, "").padEnd(minimum, "0");
  const exponentValue = Number(exponent);
  const sign = exponentValue < 0 ? "-" : match[4] === "+" ? "+" : "";
  const digits = String(Math.abs(exponentValue)).padStart(match[5]!.length, "0");
  return `${section.negative ? "-" : ""}${prefix}${integer}${trimmed ? `.${trimmed}` : ""}E${sign}${digits}${suffix}`;
}

function decimalNumber(section: DisplaySection, pattern: ProtectedPattern): string | null {
  const match = /^(.*?)([#,]*0[0#]*)(?:\.([0#]+))?(%)?(.*?)$/.exec(pattern.text);
  if (!match) return literalText(pattern.text, pattern);
  const prefix = literalText(match[1]!, pattern);
  const suffix = literalText(match[5]!, pattern);
  const integer = match[2]!;
  const decimals = match[3] ?? "";
  if (prefix === null || suffix === null || decimals.length > 100 || !/^(?:0+|#+0+|#,##0+)$/.test(integer)) return null;
  const scaled = section.magnitude * (match[4] ? 100 : 1);
  if (!Number.isFinite(scaled)) return null;
  const text = scaled.toLocaleString("en-US", {
    useGrouping: integer.includes(","),
    minimumIntegerDigits: Math.min(21, integer.replace(/[^0]/g, "").length),
    minimumFractionDigits: decimals.replace(/#/g, "").length,
    maximumFractionDigits: decimals.length
  });
  return `${section.negative ? "-" : ""}${prefix}${text}${match[4] ?? ""}${suffix}`;
}

/**
 * Lightweight Excel number display shared by import and cell editing.
 * Unknown formats preserve the raw number and notify the importer; no Excel runtime is pulled into core.
 */
export function formatExcelNumber(value: number, format?: string, onUnsupported?: () => void): string {
  if (!format || /^(General|@)$/i.test(format)) return String(value);
  const section = selectSection(value, format);
  if (section.pattern === "") return "";
  const pattern = protectPattern(section.pattern);
  const rendered = scientificNumber(section, pattern) ?? decimalNumber(section, pattern);
  if (rendered !== null) return rendered;
  onUnsupported?.();
  return String(value);
}

/** A quoted/escaped percent sign is literal text, not a numeric scaling instruction. */
export function isExcelPercentageFormat(format: string | undefined): boolean {
  return format !== undefined && format.replace(/"[^"]*"|\\./g, "").includes("%");
}
