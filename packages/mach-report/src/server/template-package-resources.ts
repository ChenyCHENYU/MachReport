import type { ReportTemplateDocument } from "../source/template-registry";
import type { PlanComponent } from "../schema/render-plan";
import { createImageMediaInspector } from "../output/media";
import { portableSha256Hex } from "./sha256";
import { controlled, throwIfAborted } from "./control";

export interface ReportPackageImageTarget {
  pageIndex: number;
  /** Top component index, then optional repeated grid-row / cell / child triplets. */
  componentPath: number[];
}
export interface ReportPackageResource {
  id: string;
  kind: "font" | "image";
  mediaType: "font/ttf" | "font/otf" | "image/png" | "image/jpeg";
  bytes: number;
  sha256: string;
  license?: string;
  font?: { family: string; face: "regular" | "bold" | "italic" | "boldItalic" };
  targets?: ReportPackageImageTarget[];
}
export interface ReportPackageResourceBytes { bytes: Uint8Array; mediaType: ReportPackageResource["mediaType"] }
export type ReportPackageResourceResolver = (resource: Readonly<ReportPackageResource>, context: { signal: AbortSignal }) => ReportPackageResourceBytes | Promise<ReportPackageResourceBytes>;
export interface ResolvedReportPackageFont { id: string; family: string; face: NonNullable<ReportPackageResource["font"]>["face"]; bytes: Uint8Array }
export function packageImageTarget(document: ReportTemplateDocument, target: ReportPackageImageTarget): PlanComponent {
  const path = target?.componentPath;
  if (!Number.isSafeInteger(target?.pageIndex) || target.pageIndex < 0 || !Array.isArray(path) || path.length < 1 || path.length > 31 || path.length % 3 !== 1 || path.some(value => !Number.isSafeInteger(value) || value < 0)) throw new TypeError("模板包图片位置无效");
  let component = document.template.pages[target.pageIndex]?.components[path[0]!] as PlanComponent | undefined;
  for (let index = 1; component && index < path.length; index += 3) component = component.grid?.cells[path[index]!]?.[path[index + 1]!]?.children?.[path[index + 2]!];
  if (!component || component.kind !== "image" || component.binding) throw new TypeError("模板包图片位置应指向静态图片组件");
  return component;
}
function resourceProperties(resource: ReportPackageResource): void {
  const allowed = ["id", "kind", "mediaType", "bytes", "sha256", "license", "font", "targets"];
  if (!resource || Object.keys(resource).some(key => !allowed.includes(key))) throw new TypeError("模板资源包含未知字段");
  if (typeof resource.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(resource.id)) throw new TypeError("模板资源ID应为安全标识");
  if (!Number.isSafeInteger(resource.bytes) || resource.bytes < 1 || resource.bytes > 32_000_000 || !/^[a-f0-9]{64}$/.test(resource.sha256)) throw new TypeError("模板资源大小或SHA256无效");
  if (resource.license !== undefined && (typeof resource.license !== "string" || resource.license.length > 512)) throw new TypeError("模板资源许可说明无效");
}
export function validatePackageResource(resource: ReportPackageResource, document: ReportTemplateDocument): void {
  resourceProperties(resource);
  if (resource.kind === "font") {
    if (!["font/ttf", "font/otf"].includes(resource.mediaType) || resource.targets !== undefined) throw new TypeError("字体资源类型无效");
    const font = resource.font;
    if (!font || typeof font.family !== "string" || !font.family.trim() || font.family.length > 128 || !["regular", "bold", "italic", "boldItalic"].includes(font.face) || Object.keys(font).some(key => !["family", "face"].includes(key))) throw new TypeError("字体资源需要family和face");
    return;
  }
  if (resource.kind !== "image" || !["image/png", "image/jpeg"].includes(resource.mediaType) || resource.font !== undefined) throw new TypeError("模板图片仅支持PNG/JPEG");
  if (!Array.isArray(resource.targets) || !resource.targets.length || resource.targets.length > 1000) throw new TypeError("模板图片需要1–1000个位置");
  for (const target of resource.targets) {
    if (Object.keys(target).some(key => !["pageIndex", "componentPath"].includes(key))) throw new TypeError("模板图片位置包含未知字段");
    packageImageTarget(document, target);
  }
}
function matchesHeader(bytes: Uint8Array, type: ReportPackageResource["mediaType"]): boolean {
  const prefix = (values: number[]) => values.every((value, index) => bytes[index] === value);
  if (type === "image/png") return prefix([137, 80, 78, 71, 13, 10, 26, 10]);
  if (type === "image/jpeg") return prefix([255, 216, 255]);
  if (type === "font/otf") return prefix([79, 84, 84, 79]);
  return prefix([0, 1, 0, 0]) || prefix([116, 114, 117, 101]);
}
export function reportPackageResourceDigest(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 32_000_000) throw new RangeError("资源摘要只接受1–32MB字节");
  return portableSha256Hex(bytes);
}
/** Existing embedded media and resolved dependencies share one decoded-image budget. */
export function inspectPackageImages(document: ReportTemplateDocument, resources: readonly ReportPackageResource[], inspect = createImageMediaInspector()): number {
  const replaced = new Set(resources.flatMap(resource => (resource.targets ?? []).map(target => packageImageTarget(document, target))));
  const images = new Map<string, number>();
  const visit = (component: PlanComponent): void => {
    if (component.imageData && !replaced.has(component)) {
      const image = inspect(component.imageData);
      images.set(image.dataUrl, image.bytes.byteLength);
    }
    for (const row of component.grid?.cells ?? []) for (const cell of row) for (const child of cell?.children ?? []) visit(child);
  };
  for (const page of document.template.pages) for (const component of page.components) visit(component as PlanComponent);
  return [...images.values()].reduce((sum, bytes) => sum + bytes, 0);
}
function imageData(bytes: Uint8Array, mediaType: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return `data:${mediaType};base64,${btoa(binary)}`;
}
export async function hydratePackageResources(document: ReportTemplateDocument, resources: readonly ReportPackageResource[], resolve: ReportPackageResourceResolver, signal?: AbortSignal, maxDurationMs = 30_000): Promise<ResolvedReportPackageFont[]> {
  if (!Number.isFinite(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 2_147_483_647) throw new RangeError("模板资源加载超时应为1–2147483647毫秒");
  return controlled(signal, maxDurationMs, async signal => {
    const fonts: ResolvedReportPackageFont[] = [], inspect = createImageMediaInspector();
    inspectPackageImages(document, resources, inspect);
    for (const resource of resources) {
      throwIfAborted(signal);
      const result = await controlled(signal, undefined, () => Promise.resolve(resolve(JSON.parse(JSON.stringify(resource)) as ReportPackageResource, { signal })));
      throwIfAborted(signal);
      if (!result || !(result.bytes instanceof Uint8Array) || result.mediaType !== resource.mediaType || result.bytes.byteLength !== resource.bytes) throw new TypeError(`资源 ${resource.id} 的类型或大小与清单不一致`);
      const bytes = new Uint8Array(result.bytes);
      if (!matchesHeader(bytes, resource.mediaType) || reportPackageResourceDigest(bytes) !== resource.sha256) throw new TypeError(`资源 ${resource.id} 的文件标识或SHA256与清单不一致`);
      if (resource.kind === "font") fonts.push({ id: resource.id, family: resource.font!.family, face: resource.font!.face, bytes });
      else {
        const data = inspect(imageData(bytes, resource.mediaType)).dataUrl;
        for (const target of resource.targets!) packageImageTarget(document, target).imageData = data;
      }
    }
    return fonts;
  });
}
