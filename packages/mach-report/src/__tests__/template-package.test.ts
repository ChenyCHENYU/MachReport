// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { defineReportTemplate } from "../source/template-registry";
import { createTableTemplate } from "../builder/table-template";
import { createReportTemplatePackage, parseReportTemplatePackage, resolveReportTemplatePackage, reportPackageResourceDigest, type ReportPackageResource } from "../server/template-package";
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJuYAAAAASUVORK5CYII=", "base64"));
const font = new Uint8Array(readFileSync(new URL("../../../../examples/minimal/public/fonts/mach-report-demo.otf", import.meta.url)));
const options = { runtimeVersion: "2.15.0" };
const document = defineReportTemplate({ id: "label", name: "Label", template: { pages: [{ widthMm: 80, heightMm: 55, components: [
  { kind: "image", leftMm: 2, topMm: 3, widthMm: 10, heightMm: 10, imageData: `data:image/png;base64,${Buffer.from(png).toString("base64")}` },
] }] } });
function fixture() {
  const resources: ReportPackageResource[] = [
    { id: "logo", kind: "image", mediaType: "image/png", bytes: png.byteLength, sha256: reportPackageResourceDigest(png), targets: [{ pageIndex: 0, componentPath: [0] }] },
    { id: "font", kind: "font", mediaType: "font/otf", bytes: font.byteLength, sha256: reportPackageResourceDigest(font), font: { family: "Demo", face: "regular" } },
  ];
  return createReportTemplatePackage({ document, minimumVersion: "2.14.0", resources,
    contracts: { detail: { fields: [{ field: "id", type: "text" }, { field: "value", type: "number" }], rowKey: "id" } },
    fixtures: [{ name: "Zero preserved", deidentified: true, datasets: { detail: [{ id: "0001", value: 0 }] } }],
  }, options);
}
describe("portable report template package", () => {
  it("round-trips independent bounded JSON metadata and explicitly sanitized samples without embedding resource bytes", async () => {
    const bundle = fixture(), original = JSON.stringify(bundle);
    expect(bundle.document.template.pages[0]!.components[0]).not.toHaveProperty("imageData");
    expect(document.template.pages[0]!.components[0]).toHaveProperty("imageData");
    const resolve = vi.fn(async (resource: ReportPackageResource) => ({ bytes: resource.id === "font" ? font : png, mediaType: resource.mediaType }));
    const result = await resolveReportTemplatePackage(JSON.stringify(bundle), { ...options, resolve });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(result.document.template.pages[0]!.components[0]).toHaveProperty("imageData", `data:image/png;base64,${Buffer.from(png).toString("base64")}`);
    expect(result.fonts[0]).toMatchObject({ family: "Demo", face: "regular" });
    expect(result.fonts[0]!.bytes).not.toBe(font);
    expect(result.fixtures[0]!.datasets.detail![0]).toEqual({ id: "0001", value: 0 });
    expect(JSON.stringify(bundle)).toBe(original);
  });
  it("rejects version/size/identity faults before any resource resolution", async () => {
    const resolve = vi.fn();
    await expect(resolveReportTemplatePackage(fixture(), { runtimeVersion: "2.13.9", resolve })).rejects.toThrow("2.14.0");
    expect(() => parseReportTemplatePackage(fixture(), { ...options, maxBytes: 40 })).toThrow("预算");
    expect(() => parseReportTemplatePackage(fixture(), { ...options, maxResourceBytes: 1 })).toThrow("总大小");
    const duplicate = fixture(); duplicate.resources.push(duplicate.resources[0]!);
    expect(() => parseReportTemplatePackage(duplicate, options)).toThrow("重复");
    const version = fixture(); version.minimumVersion = "2.14.0-beta.1";
    expect(() => parseReportTemplatePackage(version, options)).toThrow("正式版本");
    expect(resolve).not.toHaveBeenCalled();
  });
  it("compares release version tuples numerically across major, minor and patch boundaries", () => {
    for (const [minimumVersion, runtimeVersion, accepted] of [["2.9.9", "2.10.0", true], ["2.14.9", "2.14.10", true], ["2.999.9", "3.0.0", true], ["2.14.0", "2.14.0", true], ["3.0.0", "2.999.999", false], ["2.14.1", "2.14.0", false]] as const) {
      const bundle = fixture(); bundle.minimumVersion = minimumVersion;
      const read = () => parseReportTemplatePackage(bundle, { runtimeVersion });
      if (accepted) expect(read).not.toThrow(); else expect(read).toThrow("需要MachReport");
    }
  });
  it("requires explicit de-identification and checks sample contracts without coercing decimals or IDs", () => {
    const unsafe = fixture(); delete (unsafe.fixtures![0] as { deidentified?: true }).deidentified;
    expect(() => parseReportTemplatePackage(unsafe, options)).toThrow("deidentified");
    const wrong = fixture(); wrong.fixtures![0]!.datasets.detail![0]!.value = "0";
    expect(() => parseReportTemplatePackage(wrong, options)).toThrow("字段契约");
    const missing = fixture(); missing.fixtures![0]!.datasets = {};
    expect(() => parseReportTemplatePackage(missing, options)).toThrow("缺少");
  });
  it("counts nested tree sample nodes and validates every descendant against its field contract", () => {
    const tree = defineReportTemplate({ id: "tree", name: "Tree", template: createTableTemplate({ columns: [{ field: "id", header: "Id" }], listOptions: { tree: { input: "nested", idField: "id", labelField: "id" } } }) });
    const input = { document: tree, minimumVersion: "2.14.0", contracts: { detail: { fields: [{ field: "id", type: "text" as const }] } }, fixtures: [{ name: "Tree", deidentified: true as const, datasets: { detail: [{ id: "root", children: Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })) }] } }] };
    expect(() => createReportTemplatePackage(input, options)).toThrow();
    const invalid = { ...input, fixtures: [{ name: "Tree", deidentified: true as const, datasets: { detail: [{ id: "root", children: [{ id: 9 }] }] } }] };
    expect(() => createReportTemplatePackage(invalid, options)).toThrow("字段契约");
  });
  it("shares image budgets between embedded media and resolved dependencies, excluding replaced placeholders", async () => {
    const images = Array.from({ length: 5 }, (_, index) => {
      const bytes = new Uint8Array(png), view = new DataView(bytes.buffer);
      view.setUint32(16, 4000); view.setUint32(20, 4000); bytes[bytes.length - 1] = index;
      return bytes;
    });
    const components = images.map(bytes => ({ kind: "image" as const, leftMm: 0, topMm: 0, widthMm: 10, heightMm: 10, imageData: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` }));
    const imageDocument = defineReportTemplate({ id: "images", name: "Images", template: { pages: [{ widthMm: 80, heightMm: 55, components }] } });
    const resources: ReportPackageResource[] = [{ id: "external", kind: "image", mediaType: "image/png", bytes: png.length, sha256: reportPackageResourceDigest(images[4]!), targets: [{ pageIndex: 0, componentPath: [4] }] }];
    const input = { document: imageDocument, minimumVersion: "2.14.0", resources };
    expect(() => createReportTemplatePackage(input, { ...options, maxResourceBytes: png.length * 4 })).toThrow("总大小");
    const bundle = createReportTemplatePackage(input, options);
    await expect(resolveReportTemplatePackage(bundle, { ...options, resolve: () => ({ bytes: images[4]!, mediaType: "image/png" }) })).rejects.toMatchObject({ code: "image-budget-exceeded" });
    const invalid = createReportTemplatePackage({ document, minimumVersion: "2.14.0" }, options);
    (invalid.document.template.pages[0]!.components[0] as { imageData: string }).imageData = "data:image/svg+xml,<svg/>";
    const resolve = vi.fn();
    await expect(resolveReportTemplatePackage(invalid, { ...options, resolve })).rejects.toMatchObject({ code: "invalid-image-data" });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("rejects changed bytes, wrong media types and missing resources without partial results", async () => {
    const bundle = fixture();
    const damaged = new Uint8Array(png); damaged[damaged.length - 1]! ^= 1;
    await expect(resolveReportTemplatePackage(bundle, { ...options, resolve: async resource => ({ bytes: damaged, mediaType: resource.mediaType }) })).rejects.toThrow("SHA256");
    await expect(resolveReportTemplatePackage(bundle, { ...options, resolve: async () => ({ bytes: png, mediaType: "image/jpeg" }) })).rejects.toThrow("类型或大小");
    await expect(resolveReportTemplatePackage(bundle, { ...options, resolve: async () => { throw new Error("missing"); } })).rejects.toThrow("missing");
  });
  it("bounds hanging resolvers and isolates the manifest from resolver mutation", async () => {
    await expect(resolveReportTemplatePackage(fixture(), { ...options, maxDurationMs: 10, resolve: () => new Promise(() => {}) })).rejects.toMatchObject({ code: "timeout" });
    const controller = new AbortController();
    const request = resolveReportTemplatePackage(fixture(), { ...options, signal: controller.signal, resolve: () => new Promise(() => {}) }); controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await expect(resolveReportTemplatePackage(fixture(), { ...options, resolve: resource => {
      (resource as ReportPackageResource).sha256 = "0".repeat(64);
      return { bytes: resource.id === "font" ? font : png, mediaType: resource.mediaType };
    } })).resolves.toHaveProperty("fonts");
  });
  it("rejects unsafe JSON/getters, invalid targets and unexpected fields", () => {
    const get = vi.fn(); const input = { document, minimumVersion: "2.14.0" };
    Object.defineProperty(input, "resources", { get, enumerable: true });
    expect(() => createReportTemplatePackage(input, options)).toThrow("访问器"); expect(get).not.toHaveBeenCalled();
    expect(() => parseReportTemplatePackage({ ...fixture(), token: "never accepted" }, options)).toThrow("结构");
    const invalid = fixture(); invalid.resources[0]!.targets![0]!.componentPath = [9];
    expect(() => parseReportTemplatePackage(invalid, options)).toThrow("静态图片");
    const id = fixture(); delete (id.resources[0] as Partial<ReportPackageResource>).id;
    expect(() => parseReportTemplatePackage(id, options)).toThrow("ID");
  });
});
