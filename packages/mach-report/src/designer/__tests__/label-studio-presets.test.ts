import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive } from "vue";
import { decode } from "fast-png";
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";
import { validateReportTemplateDocument, type DatasetContract } from "@agile-team/mach-report";
import { createCodeAssetRenderers } from "@agile-team/mach-report/codes";
import { resolvePlanAssets } from "../../output/assets";
import { createLabelStudioDocument } from "../label-studio-template";
import { LABEL_STUDIO_PRESETS, labelDisplayFields } from "../label-studio-presets";
import { useLabelStudio, type LabelStudioOptions } from "../useLabelStudio";

const schema: DatasetContract = {
  rowKey: "id",
  fields: [
    { field: "id", type: "text" },
    { field: "code", label: "物料编号", type: "text", semanticRole: "identifier" },
    { field: "grade", label: "钢种", type: "text" },
    { field: "weight", label: "重量", type: "number" },
    { field: "size", label: "尺寸", type: "text" },
    { field: "owner", label: "检验员", type: "text" },
    { field: "standard", label: "执行标准", type: "text" },
    { field: "copies", label: "份数", type: "number" },
  ],
};
const rows = [{ id: "1", code: "00018", grade: "S304", weight: 0, copies: 2 }];
const dispose: (() => void)[] = [];
afterEach(() => { dispose.splice(0).forEach(stop => stop()); document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture(options: Partial<LabelStudioOptions> = {}) {
  const props = reactive<LabelStudioOptions>({ rows, schema, title: "物料标识", ...options });
  let studio!: ReturnType<typeof useLabelStudio>;
  const target = document.createElement("div"); document.body.append(target);
  const app = createApp(defineComponent({ setup() { studio = useLabelStudio(props, () => {}); return () => h("div"); } }));
  app.mount(target); dispose.push(() => app.unmount());
  return { props, studio };
}

function scanQr(imageData: string): string {
  const image = decode(Uint8Array.from(atob(imageData.split(",")[1]!), character => character.charCodeAt(0)));
  const source = new RGBLuminanceSource(new Uint8ClampedArray(image.data), image.width, image.height);
  const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]], [DecodeHintType.CHARACTER_SET, "UTF-8"]]);
  return new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText();
}

it("three finished presets bind only declared fields and preserve every selected display field", () => {
  for (const preset of LABEL_STUDIO_PRESETS) {
    const document = createLabelStudioDocument(schema, "生产标识", "code", { preset: preset.id, brand: { name: "实际公司", tagline: "物料管理" }, fields: ["standard", "weight", "grade", "size", "owner"] });
    expect(validateReportTemplateDocument(document).ok).toBe(true);
    expect(document.template.pages).toHaveLength(preset.faces);
    const first = document.template.pages[0]!;
    expect([first.widthMm, first.heightMm]).toEqual([preset.widthMm, preset.heightMm]);
    const bindings = first.components.flatMap(component => component.kind !== "list" && component.binding ? [component.binding.field] : []);
    for (const field of ["code", "standard", "weight", "grade", "size", "owner"]) expect(bindings).toContain(field);
    expect(JSON.stringify(document)).not.toMatch(/MACHREPORT|MR20261022|MACH STEEL/);
    expect(first.components.some(component => component.kind !== "list" && component.text === "实际公司")).toBe(true);
    expect(first.components.every(component => component.leftMm + component.widthMm <= first.widthMm && component.topMm + (component.kind === "list" ? 0 : component.heightMm) <= first.heightMm)).toBe(true);
  }
});

it("default display fields favor declared dimensions and unit-bearing measures and explicit limits are visible errors", () => {
  const fields: DatasetContract["fields"] = [
    ...Array.from({ length: 6 }, (_, index) => ({ field: `raw${index}`, type: "text" as const })),
    { field: "weight", label: "重量", type: "number", semanticRole: "measure", unit: "kg" },
    { field: "grade", label: "钢种", type: "text", semanticRole: "dimension" },
    { field: "name", label: "品名", type: "text" },
  ];
  expect(labelDisplayFields({ fields }).map(field => field.field)).toEqual(["name", "grade", "weight", "raw0", "raw1"]);
  expect(() => createLabelStudioDocument(schema, "超出上限", "code", { fields: ["grade", "weight", "size", "owner", "standard", "copies"] })).toThrow("最多显示 5 个字段");
  expect(() => createLabelStudioDocument(schema, "错误绑定", "code", { fields: ["notDeclared"] })).toThrow("未在业务契约中声明");
});

it("preset settings preserve original values, zero and number strings while omitting unselected fields", async () => {
  const f = fixture({ preset: "material", fields: ["weight"], brand: { name: "实际公司" } });
  const source = JSON.stringify(rows);
  const plan = await f.studio.fetcher.value({ reportIds: ["labels"], params: {} });
  const components = plan.pages[0]!.components;
  expect(components.some(component => component.text === "00018")).toBe(true);
  expect(components.some(component => component.text === "0")).toBe(true);
  expect(components.some(component => component.text === "S304")).toBe(false);
  expect(JSON.stringify(rows)).toBe(source);
  expect(plan.pages).toHaveLength(1);
});

it("finished front, back and warehouse previews encode Unicode identities as independently readable QR images", async () => {
  const identity = "炉号26W015 · 客户甲 🏭";
  for (const preset of LABEL_STUDIO_PRESETS) {
    const f = fixture({ preset: preset.id, rows: [{ id: "U1", code: identity, weight: 0 }], fields: ["weight"] });
    const plan = await f.studio.fetcher.value({ reportIds: ["labels"], params: {} });
    const result = await resolvePlanAssets(plan, { assetRenderers: createCodeAssetRenderers() });
    expect(result.diagnostics).toEqual([]);
    expect(result.plan.pages).toHaveLength(preset.faces);
    for (const page of result.plan.pages) {
      expect(page.components.some(component => component.kind === "barcode")).toBe(false);
      const code = page.components.find(component => component.kind === "qrcode")!;
      expect(code.imageData).toMatch(/^data:image\/png;base64,/);
      expect(scanQr(code.imageData!)).toBe(identity);
    }
  }
});

it("custom documents remain authoritative until an explicit layout command and keep identity, revision and copies", () => {
  const custom = createLabelStudioDocument(schema, "自定义");
  custom.id = "host-label"; custom.revision = "v7"; custom.template.repeat!.copies = 3;
  custom.template.pages[0]!.components.push({ kind: "text", leftMm: 1, topMm: 1, widthMm: 5, heightMm: 5, text: "用户内容" });
  const before = JSON.stringify(custom);
  const f = fixture({ modelValue: custom, preset: "material" });
  expect(JSON.stringify(f.studio.document.value)).toBe(before);
  const apply = vi.fn((template) => { f.studio.update({ ...f.studio.document.value, template }); return true; });
  f.studio.editor.value = { pendingLocalChanges: false, canApply: true, applyTemplate: apply, insertComponent: () => false, save: async () => {}, reset: async () => {}, guardChanges: async () => true };
  f.studio.preset.value = "warehouse";
  f.studio.fields.value = ["weight", "standard"];
  expect(f.studio.applyConfiguration()).toBe(false);
  expect(f.studio.rebuilding.value).toBe(true);
  expect(apply).not.toHaveBeenCalled();
  f.studio.applyConfiguration(true);
  expect(apply).toHaveBeenCalledOnce();
  expect(f.studio.document.value).toMatchObject({ id: "host-label", revision: "v7", template: { repeat: { copies: 3 } } });
  expect(f.studio.document.value.template.pages).toHaveLength(1);
  expect(f.studio.configurationDirty.value).toBe(false);
});

it("fixed-copy counts inspect no records and field-copy counts do not rescan after a title-only change", async () => {
  let reads = 0;
  const records = Array.from({ length: 10_000 }, (_, index) => new Proxy({ id: String(index), code: String(index), copies: 2 }, { getOwnPropertyDescriptor(target, key) { reads++; return Reflect.getOwnPropertyDescriptor(target, key); } }));
  const f = fixture({ rows: records });
  expect(f.studio.labelCount.value).toBe(20_000);
  expect(reads).toBe(0);
  const next = structuredClone(f.studio.document.value);
  next.template.repeat!.copies = { field: "copies" };
  f.studio.update(next);
  expect(f.studio.labelCount.value).toBe(40_000);
  const count = reads;
  expect(count).toBeGreaterThan(0);
  const renamed = structuredClone(f.studio.document.value); renamed.name = "仅改名称";
  f.studio.update(renamed); await nextTick();
  expect(f.studio.labelCount.value).toBe(40_000);
  expect(reads).toBe(count);
});

it("design data remains bounded while the normal fetcher outputs the full query snapshot", async () => {
  const records = Array.from({ length: 11 }, (_, index) => ({ id: String(index), code: `P${index}`, weight: index }));
  const f = fixture({ rows: records, fields: ["weight"] });
  expect(f.studio.designDatasets.value.records).toHaveLength(3);
  expect(f.studio.datasets.value.records).toHaveLength(11);
  const plan = await f.studio.fetcher.value({ reportIds: ["labels"], params: {} });
  expect(plan.pages).toHaveLength(22);
  expect(plan.pages.at(-1)!.components.some(component => component.text === "P10")).toBe(true);
});

it("portable brand images are accepted and unsupported images fail before replacing the active template", () => {
  const logoData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const branded = createLabelStudioDocument(schema, "Logo", "code", { brand: { logoData } });
  expect(branded.template.pages[0]!.components.find(component => component.kind === "image")).toMatchObject({ imageData: logoData });
  const f = fixture({ brand: { name: "公司" } });
  const before = JSON.stringify(f.studio.document.value);
  f.props.brand = { logoData: "data:image/svg+xml;base64,PHN2Zz4=" };
  expect(f.studio.custom.value).toBe(true);
  f.studio.applyConfiguration();
  expect(f.studio.notice.value).toContain("PNG或JPEG");
  expect(JSON.stringify(f.studio.document.value)).toBe(before);
});
