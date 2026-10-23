import { version as installedVersion } from "../../package.json";
import { snapshotReportJson } from "../schema/json-snapshot";
import { parseReportTemplate, type ReportTemplateDocument } from "../source/template-registry";
import { validateDatasetRows, type DatasetContract } from "../schema/dataset";
import type { DatasetRows } from "../layout/paginate";
import { validateReportParams } from "../source/param-validation";
import { templateValidationDatasets } from "../source/template-tree-data";
import { throwIfAborted } from "./control";
import { hydratePackageResources, inspectPackageImages, packageImageTarget, validatePackageResource, type ReportPackageResource, type ReportPackageResourceResolver } from "./template-package-resources";
export { reportPackageResourceDigest } from "./template-package-resources";
export type { ReportPackageResource, ReportPackageImageTarget, ReportPackageResourceResolver, ReportPackageResourceBytes, ResolvedReportPackageFont } from "./template-package-resources";

export interface ReportPackageFixture {
  name: string;
  /** Explicit host confirmation; the SDK does not infer that business values are anonymous. */
  deidentified: true;
  datasets: DatasetRows;
  params?: Record<string, string>;
}
export interface ReportTemplatePackage {
  schemaVersion: "1.0";
  minimumVersion: string;
  document: ReportTemplateDocument;
  contracts?: Record<string, DatasetContract>;
  resources: ReportPackageResource[];
  fixtures?: ReportPackageFixture[];
}
export interface ReportTemplatePackageOptions {
  /** Installed SDK version, compared before any resolver or persistence is called. */
  runtimeVersion?: string;
  maxBytes?: number;
  maxResourceBytes?: number;
  signal?: AbortSignal;
}
function version(value: string): number[] {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)) throw new TypeError("模板包最低版本与运行版本应为正式版本x.y.z");
  return value.split(".").map(Number);
}
function checkVersion(minimum: string, current: string): void {
  const required = version(minimum), installed = version(current);
  for (let index = 0; index < 3; index++) {
    if (installed[index]! > required[index]!) return;
    if (installed[index]! < required[index]!) throw new Error(`模板包需要MachReport ${minimum}或更新版本`);
  }
}
function byteBudget(value: number | undefined, fallback: number, maximum: number): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) throw new RangeError("模板包字节预算无效");
  return limit;
}
function contracts(input: ReportTemplatePackage): void {
  if (input.contracts === undefined) return;
  if (!input.contracts || typeof input.contracts !== "object" || Array.isArray(input.contracts) || Object.keys(input.contracts).length > 100) throw new TypeError("模板包字段契约应为最多100个数据集");
  for (const [dataset, contract] of Object.entries(input.contracts)) {
    if (!dataset.trim() || dataset.length > 256) throw new TypeError("模板包数据集名称无效");
    validateDatasetRows([], contract);
  }
}
function fixture(fixture: ReportPackageFixture, input: ReportTemplatePackage): void {
  if (!fixture || fixture.deidentified !== true || typeof fixture.name !== "string" || !fixture.name.trim() || fixture.name.length > 128) throw new TypeError("样例需要名称和明确的deidentified:true确认");
  if (Object.keys(fixture).some(key => !["name", "deidentified", "datasets", "params"].includes(key))) throw new TypeError("模板包样例包含未知字段");
  if (!fixture.datasets || typeof fixture.datasets !== "object" || Array.isArray(fixture.datasets)) throw new TypeError("模板包样例数据集无效");
  fixtureDatasets(fixture, input);
  const checked = validateReportParams(input.document.template.params ?? [], fixture.params);
  if (!checked.ok) throw new TypeError(`样例 ${fixture.name} 的参数不符合模板定义`);
}
function fixtureDatasets(fixture: ReportPackageFixture, input: ReportTemplatePackage): void {
  let rows = 0;
  for (const data of Object.values(fixture.datasets)) {
    if (!Array.isArray(data) || data.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new TypeError("模板包样例应为对象行数组");
  }
  const datasets = templateValidationDatasets(input.document.template, fixture.datasets, { maxRows: 1000 });
  for (const [name, data] of Object.entries(datasets)) {
    rows += data.length;
    if (rows > 1000) throw new RangeError("模板包每个样例最多1000行");
    const contract = input.contracts?.[name];
    if (contract && !validateDatasetRows(data, contract).ok) throw new TypeError(`样例 ${fixture.name} 不符合 ${name} 字段契约`);
  }
  for (const name of Object.keys(input.contracts ?? {})) if (!Object.prototype.hasOwnProperty.call(fixture.datasets, name)) throw new TypeError(`样例 ${fixture.name} 缺少 ${name} 数据集`);
}
function fixtures(input: ReportTemplatePackage): void {
  if (input.fixtures === undefined) return;
  if (!Array.isArray(input.fixtures) || input.fixtures.length > 20) throw new RangeError("模板包最多20个脱敏样例");
  const names = new Set<string>();
  for (const item of input.fixtures) {
    fixture(item, input);
    if (names.has(item.name)) throw new TypeError("模板包样例名称重复");
    names.add(item.name);
  }
}
function resources(input: ReportTemplatePackage, limit: number): void {
  if (!Array.isArray(input.resources) || input.resources.length > 64) throw new RangeError("模板包最多64个资源依赖");
  const ids = new Set<string>(), targets = new Set<string>(), fonts = new Set<string>();
  let bytes = 0;
  for (const resource of input.resources) {
    validatePackageResource(resource, input.document);
    if (ids.has(resource.id)) throw new TypeError("模板资源ID重复");
    ids.add(resource.id); bytes += resource.bytes;
    if (bytes > limit) throw new RangeError("模板包资源总大小超过预算");
    const font = resource.font && JSON.stringify([resource.font.family, resource.font.face]);
    if (font && fonts.has(font)) throw new TypeError("模板包字体family/face重复");
    if (font) fonts.add(font);
    for (const target of resource.targets ?? []) {
      const identity = JSON.stringify([target.pageIndex, target.componentPath]);
      if (targets.has(identity)) throw new TypeError("同一图片位置不能绑定多个资源");
      targets.add(identity);
    }
  }
  if (bytes + inspectPackageImages(input.document, input.resources) > limit) throw new RangeError("模板包内嵌与外部资源总大小超过预算");
}
/** Parse a bounded manifest without network access, code execution, registration or publication. */
export function parseReportTemplatePackage(input: unknown, options: ReportTemplatePackageOptions = {}): ReportTemplatePackage {
  throwIfAborted(options.signal);
  const maximum = byteBudget(options.maxBytes, 8_000_000, 32_000_000);
  if (typeof input === "string") {
    if (input.length > maximum || new TextEncoder().encode(input).byteLength > maximum) throw new RangeError("模板包JSON超过预算");
    input = JSON.parse(input) as unknown;
  }
  const result = snapshotReportJson(input, { maxBytes: maximum, check: () => throwIfAborted(options.signal), error: (_code, message) => new TypeError(message) }) as ReportTemplatePackage;
  if (!result || typeof result !== "object" || Array.isArray(result) || result.schemaVersion !== "1.0" || Object.keys(result).some(key => !["schemaVersion", "minimumVersion", "document", "contracts", "resources", "fixtures"].includes(key))) throw new TypeError("模板包结构或版本无效");
  checkVersion(result.minimumVersion, options.runtimeVersion ?? installedVersion);
  result.document = parseReportTemplate(result.document);
  contracts(result); fixtures(result); resources(result, byteBudget(options.maxResourceBytes, 32_000_000, 64_000_000));
  return result;
}
/** Export explicitly selected metadata/samples; external resource bytes stay in host-managed storage. */
export function createReportTemplatePackage(input: Omit<ReportTemplatePackage, "schemaVersion" | "resources" | "minimumVersion"> & { resources?: ReportPackageResource[]; minimumVersion?: string }, options: ReportTemplatePackageOptions = {}): ReportTemplatePackage {
  const snapshot = snapshotReportJson(input, { maxBytes: byteBudget(options.maxBytes, 8_000_000, 32_000_000), check: () => throwIfAborted(options.signal), error: (_code, message) => new TypeError(message) });
  const result = parseReportTemplatePackage({ schemaVersion: "1.0", ...snapshot, minimumVersion: snapshot.minimumVersion ?? installedVersion, resources: snapshot.resources ?? [] }, options);
  for (const resource of result.resources) for (const target of resource.targets ?? []) delete packageImageTarget(result.document, target).imageData;
  return result;
}
/** Verify all host-resolved bytes before returning a hydrated independent document. No implicit save. */
export async function resolveReportTemplatePackage(input: unknown, options: ReportTemplatePackageOptions & { resolve: ReportPackageResourceResolver; maxDurationMs?: number }) {
  const { resolve, signal, maxDurationMs } = options;
  const value = parseReportTemplatePackage(input, options);
  const fonts = await hydratePackageResources(value.document, value.resources, resolve, signal, maxDurationMs);
  return { document: value.document, fonts, contracts: value.contracts, fixtures: value.fixtures ?? [] };
}
