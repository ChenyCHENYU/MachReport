import type { PlanComponent } from "../schema/render-plan";
import { codeOptionIssues, type CodeOptions } from "../schema/code-options";
import { CodeImageError, codeInput, type CodeImageOptions } from "./types";

export interface ResolvedCode {
  value: string;
  kind: "qrcode" | "barcode";
  symbology: NonNullable<CodeOptions["symbology"]>;
  errorCorrection: NonNullable<CodeOptions["errorCorrection"]>;
  quiet: number;
  showText: boolean;
  width: number;
  height: number;
}

const LIMITS: Required<CodeImageOptions> = { dpi: 600, maxTextBytes: 8192, maxPixels: 16_000_000, maxDimensionPx: 8192, maxCacheEntries: 1024, maxCacheBytes: 64 * 1024 * 1024 };
const DEFAULTS: Required<CodeImageOptions> = { dpi: 300, maxTextBytes: 2048, maxPixels: 4_000_000, maxDimensionPx: 4096, maxCacheEntries: 64, maxCacheBytes: 8 * 1024 * 1024 };

export function resolveCodeImageOptions(input: CodeImageOptions): Required<CodeImageOptions> {
  codeInput(typeof input === "object" && input !== null && !Array.isArray(input), "Code image options must be an object.", "options");
  const result = { ...DEFAULTS, ...input };
  for (const key of Object.keys(result) as Array<keyof CodeImageOptions>) {
    codeInput(Object.prototype.hasOwnProperty.call(DEFAULTS, key), "Unknown code image option.", `options.${key}`);
    const minimum = key.startsWith("maxCache") ? 0 : key === "dpi" ? 72 : 1;
    codeInput(Number.isSafeInteger(result[key]) && result[key] >= minimum && result[key] <= LIMITS[key], `Code image option must be a whole number between ${minimum} and ${LIMITS[key]}.`, `options.${key}`);
  }
  return result;
}

function payload(component: Readonly<PlanComponent>, options: Required<CodeImageOptions>): string {
  const value = component.code?.value ?? component.fallbackText ?? component.text;
  codeInput(typeof value === "string" && value.trim().length > 0, "Provide non-empty symbol content or bind a business field.", "code.value");
  codeInput(value.length <= options.maxTextBytes, "Symbol payload exceeds the text budget.", "code.value");
  for (const character of value) {
    const point = character.codePointAt(0)!;
    codeInput((point >= 32 || [9, 10, 13].includes(point)) && point !== 127, "Symbol payload contains unsupported control characters.", "code.value");
    codeInput(point < 0xd800 || point > 0xdfff, "Symbol payload contains an invalid Unicode sequence.", "code.value");
  }
  codeInput(new TextEncoder().encode(value).byteLength <= options.maxTextBytes, "Symbol payload exceeds the UTF-8 text budget.", "code.value");
  return value;
}

function eanCheck(value: string, length: number): void {
  codeInput(new RegExp(`^\\d{${length}}$`).test(value), `EAN content must contain exactly ${length} digits, including its check digit.`, "code.value");
  let sum = 0;
  for (let index = 0; index < length - 1; index++) sum += Number(value[index]) * ((length - index) % 2 === 0 ? 3 : 1);
  codeInput((10 - sum % 10) % 10 === Number(value[length - 1]), "EAN check digit does not match the payload.", "code.value");
}

function linearPayload(value: string, symbology: ResolvedCode["symbology"]): void {
  codeInput(value.length <= 256 && /^[\x20-\x7e]+$/.test(value), "Linear barcode content must contain at most 256 printable ASCII characters.", "code.value");
  if (symbology === "code39") codeInput(/^[0-9A-Z .\-$/+%]+$/.test(value), "Code39 accepts uppercase letters, digits, spaces and -.$/+%.", "code.value");
  if (symbology === "ean13" || symbology === "ean8") eanCheck(value, symbology === "ean13" ? 13 : 8);
}

function dimensions(component: Readonly<PlanComponent>, options: Required<CodeImageOptions>): { width: number; height: number } {
  for (const key of ["widthMm", "heightMm"] as const) codeInput(Number.isFinite(component[key]) && component[key] > 0 && component[key] <= 1000, "Symbol dimensions must be positive, finite and at most 1000 mm.", key);
  if (component.kind === "qrcode") codeInput(Math.abs(component.widthMm - component.heightMm) <= 0.01, "QR codes require a square component to preserve their modules.", "widthMm");
  const width = Math.round(component.widthMm * options.dpi / 25.4), height = Math.round(component.heightMm * options.dpi / 25.4);
  if (width < 1 || height < 1 || width > options.maxDimensionPx || height > options.maxDimensionPx || width * height > options.maxPixels) throw new CodeImageError("capacity", "Symbol raster exceeds its dimension or pixel budget.", "geometry");
  return { width, height };
}

export function resolveCode(component: Readonly<PlanComponent>, options: Required<CodeImageOptions>): ResolvedCode {
  codeInput(typeof component === "object" && component !== null, "A code component is required.", "component");
  if (component.kind !== "barcode" && component.kind !== "qrcode") throw new CodeImageError("unsupported-format", "Only barcode and qrcode components can be encoded.", "kind");
  const code = component.code === undefined ? {} : component.code, issue = codeOptionIssues(code, component.kind)[0];
  if (issue) throw new CodeImageError("invalid-input", issue.message, `code${issue.path ? `.${issue.path}` : ""}`);
  const value = payload(component, options), symbology = code.symbology ?? "code128";
  if (component.kind === "barcode") linearPayload(value, symbology);
  const minimumQuiet = component.kind === "qrcode" ? 4 : symbology.startsWith("ean") ? 11 : 10;
  return { value, kind: component.kind, symbology, errorCorrection: code.errorCorrection ?? "M", quiet: code.quietZoneModules ?? minimumQuiet, showText: code.showText ?? false, ...dimensions(component, options) };
}
