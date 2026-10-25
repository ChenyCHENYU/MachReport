import type { ComponentImageContext, ImageComponentKind } from "./assets";

export type ReportComponentValue = string | number | boolean | null;
export type ReportComponentJson = ReportComponentValue | readonly ReportComponentJson[] | { readonly [key: string]: ReportComponentJson };
export interface ReportComponentProperty {
  label: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  default?: ReportComponentValue;
  options?: readonly ReportComponentValue[];
  min?: number;
  max?: number;
  maxLength?: number;
}
export interface ReportComponentExtensionMetadata {
  id: string;
  version: string;
  kind: ImageComponentKind;
  label: string;
  description?: string;
  properties?: Readonly<Record<string, ReportComponentProperty>>;
}
export interface ReportComponentExtensionBinding {
  id: string;
  version: string;
  props: Readonly<Record<string, ReportComponentValue>>;
  /** Host-defined JSON only: core does not execute queries, scripts or property paths in this binding. */
  binding?: ReportComponentJson;
}
export interface ReportComponentExtensionContext extends ComponentImageContext {
  readonly extension: Readonly<ReportComponentExtensionBinding>;
}
export interface ReportComponentExtensionRenderer {
  render(context: ReportComponentExtensionContext): string | Promise<string>;
  dispose?(): void | Promise<void>;
}
export interface ReportComponentExtensionDefinition extends ReportComponentExtensionMetadata {
  /** Trusted runtime loader, never read from template JSON or a remote import URL. */
  load(signal: AbortSignal): ReportComponentExtensionRenderer | Promise<ReportComponentExtensionRenderer>;
}
export class ReportComponentExtensionError extends Error {
  constructor(readonly code: "definition" | "binding" | "load" | "disposed", message: string, readonly path = "$", readonly extensionId?: string) {
    super(message); this.name = "ReportComponentExtensionError";
  }
}
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
interface JsonBudget { nodes: number; units: number }

/** Bounded own-data clone, not JSON.stringify: no getters/toJSON/functions can run while validating metadata. */
export function extensionJson(value: unknown, path = "$", budget: JsonBudget = { nodes: 0, units: 0 }, depth = 0): ReportComponentJson {
  if (++budget.nodes > 2048 || depth > 16) throw new ReportComponentExtensionError("binding", "Component extension JSON exceeds its depth/node budget.", path);
  if (budget.units > 64 * 1024) throw new ReportComponentExtensionError("binding", "Component extension JSON exceeds 64 Ki UTF-16 units.", path);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    budget.units += value.length;
    if (budget.units > 64 * 1024) throw new ReportComponentExtensionError("binding", "Component extension JSON exceeds 64 Ki UTF-16 units.", path);
    return value;
  }
  if (!value || typeof value !== "object") throw new ReportComponentExtensionError("binding", "Component extension values must be finite JSON data.", path);
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) return extensionJsonArray(value, path, budget, depth);
  if (prototype !== Object.prototype && prototype !== null) throw new ReportComponentExtensionError("binding", "Component extension values must be plain JSON objects.", path);
  return extensionJsonObject(value, path, budget, depth);
}
function ownJsonValue(object: object, key: PropertyKey, path: string): unknown {
  const property = Object.getOwnPropertyDescriptor(object, key);
  if (typeof key !== "string" || UNSAFE.has(key) || !property?.enumerable || property.get || property.set)
    throw new ReportComponentExtensionError("binding", "Component extension JSON contains an unsafe key or accessor.", path);
  return property.value;
}
function extensionJsonArray(value: unknown[], path: string, budget: JsonBudget, depth: number): readonly ReportComponentJson[] {
  if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 2048 || Reflect.ownKeys(value).length !== value.length + 1) throw new ReportComponentExtensionError("binding", "Component extension arrays must be plain dense JSON arrays.", path);
  return Object.freeze(Array.from({ length: value.length }, (_, index) => extensionJson(ownJsonValue(value, String(index), `${path}[${index}]`), `${path}[${index}]`, budget, depth + 1)));
}
function extensionJsonObject(value: object, path: string, budget: JsonBudget, depth: number): { readonly [key: string]: ReportComponentJson } {
  const keys = Reflect.ownKeys(value);
  if (keys.length > 2048) throw new ReportComponentExtensionError("binding", "Component extension JSON exceeds its node budget.", path);
  const entries = keys.map(key => {
    const nextPath = `${path}.${String(key)}`, item = ownJsonValue(value, key, nextPath);
    budget.units += String(key).length;
    return [key, extensionJson(item, nextPath, budget, depth + 1)] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}
export function extensionRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReportComponentExtensionError("binding", "Expected a component extension object.", path);
  return value as Record<string, unknown>;
}
export function extensionKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new ReportComponentExtensionError("binding", "Unknown component extension property.", `${path}.${key}`);
}
function label(value: unknown, path: string, max = 160): void {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new ReportComponentExtensionError("definition", "Component extension labels must be bounded nonempty strings.", path);
}
export function checkExtensionIdentity(id: unknown, version: unknown): void {
  if (typeof id !== "string" || !/^[a-z][a-z\d_.-]{0,127}$/i.test(id)) throw new ReportComponentExtensionError("definition", "Invalid component extension id.", "$.id");
  if (typeof version !== "string" || version.length > 64 || !/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(version)) throw new ReportComponentExtensionError("definition", "Component extension version must be explicit semantic version text.", "$.version", id);
}
export function propertyValue(value: unknown, property: ReportComponentProperty, path: string): void {
  if (value === null && !property.required) return;
  if (typeof value !== property.type || typeof value === "number" && !Number.isFinite(value)) throw new ReportComponentExtensionError("binding", `Expected ${property.type} component property.`, path);
  if (property.options && !property.options.some(option => Object.is(option, value))) throw new ReportComponentExtensionError("binding", "Component property is outside its declared options.", path);
  if (typeof value === "number" && (value < (property.min ?? -Infinity) || value > (property.max ?? Infinity))) throw new ReportComponentExtensionError("binding", "Component property is outside its declared range.", path);
  if (typeof value === "string" && value.length > (property.maxLength ?? 64 * 1024)) throw new ReportComponentExtensionError("binding", "Component property exceeds maxLength.", path);
}
function checkProperty(value: unknown, path: string): void {
  const record = extensionRecord(value, path);
  extensionKeys(record, ["label", "type", "required", "default", "options", "min", "max", "maxLength"], path);
  const property = record as unknown as ReportComponentProperty;
  label(property.label, `${path}.label`);
  if (!["string", "number", "boolean"].includes(property.type)) throw new ReportComponentExtensionError("definition", "Unknown component property type.", path);
  if (property.required !== undefined && typeof property.required !== "boolean") throw new ReportComponentExtensionError("definition", "Component property required must be boolean.", path);
  checkPropertyLimits(property, path);
  if (property.default !== undefined) propertyValue(property.default, property, `${path}.default`);
}
function checkPropertyLimits(property: ReportComponentProperty, path: string): void {
  for (const key of ["min", "max"] as const) if (property[key] !== undefined && (property.type !== "number" || !Number.isFinite(property[key]))) throw new ReportComponentExtensionError("definition", "Numeric property bounds must be finite numbers.", path);
  if ((property.min ?? -Infinity) > (property.max ?? Infinity)) throw new ReportComponentExtensionError("definition", "Component property min exceeds max.", path);
  if (property.maxLength !== undefined && (property.type !== "string" || !Number.isSafeInteger(property.maxLength) || property.maxLength < 0 || property.maxLength > 64 * 1024)) throw new ReportComponentExtensionError("definition", "Invalid component property maxLength.", path);
  if (property.options !== undefined) {
    if (!Array.isArray(property.options) || !property.options.length || property.options.length > 64) throw new ReportComponentExtensionError("definition", "Component property options must contain 1 to 64 values.", path);
    for (const value of property.options) propertyValue(value, { ...property, options: undefined }, `${path}.options`);
  }
}
export function extensionMetadata(input: ReportComponentExtensionDefinition): Readonly<ReportComponentExtensionMetadata> {
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new ReportComponentExtensionError("definition", "Component extension metadata must be a plain object.");
  const entries = Reflect.ownKeys(input).filter(key => key !== "load").map(key => [key, ownJsonValue(input, key, `$.${String(key)}`)] as const);
  const metadata = extensionJson(Object.fromEntries(entries)) as unknown as ReportComponentExtensionMetadata;
  extensionKeys(metadata as unknown as Record<string, unknown>, ["id", "version", "kind", "label", "description", "properties"], "$");
  checkExtensionIdentity(metadata.id, metadata.version); label(metadata.label, "$.label");
  if (!["image", "chart", "barcode", "qrcode"].includes(metadata.kind)) throw new ReportComponentExtensionError("definition", "Extension kind must use the existing image-backed output pipeline.", "$.kind");
  if (metadata.description !== undefined) label(metadata.description, "$.description", 2048);
  if (metadata.properties !== undefined) {
    const properties = extensionRecord(metadata.properties, "$.properties");
    if (Object.keys(properties).length > 64) throw new ReportComponentExtensionError("definition", "Component extension supports at most 64 properties.", "$.properties");
    for (const [key, value] of Object.entries(properties)) checkProperty(value, `$.properties.${key}`);
  }
  return metadata;
}
export function extensionProps(metadata: Readonly<ReportComponentExtensionMetadata>, input: unknown): Readonly<Record<string, ReportComponentValue>> {
  const props = extensionRecord(extensionJson(input ?? {}), "$.props"), result: Record<string, ReportComponentValue> = {};
  for (const key of Object.keys(props)) if (!Object.prototype.hasOwnProperty.call(metadata.properties ?? {}, key)) throw new ReportComponentExtensionError("binding", "Unknown component property.", `$.props.${key}`, metadata.id);
  for (const [key, property] of Object.entries(metadata.properties ?? {})) {
    const value = Object.prototype.hasOwnProperty.call(props, key) ? props[key] : property.default;
    if (value === undefined) { if (property.required) throw new ReportComponentExtensionError("binding", "Required component property is missing.", `$.props.${key}`, metadata.id); continue; }
    propertyValue(value, property, `$.props.${key}`); result[key] = value as ReportComponentValue;
  }
  return Object.freeze(result);
}
