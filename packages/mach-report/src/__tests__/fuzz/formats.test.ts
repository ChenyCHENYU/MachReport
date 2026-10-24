// @vitest-environment node
import { expect, it } from "vitest";
import fc from "fast-check";
import ExcelJS from "exceljs";
import { createTableTemplate } from "../../builder/table-template";
import { paginateTemplate } from "../../layout/paginate";
import { validateRenderPlan } from "../../schema/validate";
import { defineReportTemplate, parseReportTemplate, serializeReportTemplate, validateReportTemplate, validateReportTemplateDocument } from "../../source/template-registry";
import { validateReportParams, type ReportParamValidation } from "../../source/param-validation";
import { createImageMediaInspector, ImageMediaError } from "../../output/media";
import { checkedExcelBytes } from "../../xlsx/import-zip";
import { ImportWarnings, resolveImportOptions } from "../../xlsx/import-types";
import { importExcelTemplate } from "../../xlsx/import-template";
import { renderPlanToXlsx } from "../../xlsx/render-xlsx";
import { fuzzOptions } from "./options";

it("bounded arbitrary JSON always produces structured template/plan validation", () => {
  fc.assert(fc.property(fc.jsonValue({ maxDepth: 5 }), input => {
    for (const validate of [validateRenderPlan, validateReportTemplate, validateReportTemplateDocument]) {
      const result = validate(input);
      expect(result.ok).toBe(result.errors.length === 0);
      for (const issue of [...result.errors, ...result.warnings]) {
        expect(typeof issue.path).toBe("string"); expect(typeof issue.message).toBe("string");
      }
    }
  }), fuzzOptions(1));
});

it("valid generated templates and source data round-trip without losing zero, IDs or Unicode", () => {
  fc.assert(fc.property(fc.string({ maxLength: 64 }), fc.array(fc.record({ qty: fc.integer({ min: -1_000_000, max: 1_000_000 }), label: fc.string({ maxLength: 32 }) }), { maxLength: 15 }), (title, rows) => {
    const detail = rows.map((row, index) => ({ ...row, id: String(index).padStart(6, "0") }));
    const template = createTableTemplate({ title, columns: [{ field: "id", header: "ID" }, { field: "qty", header: "Quantity", valueType: "number" }, { field: "label", header: "Label" }] });
    const document = defineReportTemplate({ id: "fuzz-report", name: "Seeded case", template });
    const parsed = parseReportTemplate(serializeReportTemplate(document));
    expect(parsed).toEqual(document);
    const plan = paginateTemplate(parsed.template, { detail }).plan;
    expect(validateRenderPlan(plan).ok).toBe(true);
    const sources = plan.pages.flatMap(page => page.components).filter(component => component.table?.role === "body");
    expect(sources.map(component => component.grid?.cells[0]?.[0]?.text)).toEqual(detail.map(row => row.id));
  }), fuzzOptions(2));
});

it("parameter defaults and supplied values safely preserve prototype-shaped field names", () => {
  fc.assert(fc.property(fc.constantFrom("__proto__", "constructor", "toString", "normal", "0"), fc.string({ minLength: 1, maxLength: 30 }).filter(value => !!value.trim()), (field, value) => {
    const defs = [{ field, type: "text" as const, defaultValue: value }];
    for (const result of [validateReportParams(defs), validateReportParams(defs, Object.fromEntries([[field, value]]))]) {
      expect(result.ok).toBe(true);
      for (const dictionary of [result.values, result.typedValues] as Array<ReportParamValidation["values"] | ReportParamValidation["typedValues"]>) {
        expect(Object.prototype.hasOwnProperty.call(dictionary, field)).toBe(true);
        expect(dictionary[field]).toBe(value); expect(Object.getPrototypeOf(dictionary)).toBeNull();
      }
    }
  }), fuzzOptions(3));
});

it("bad geometry produces structured errors for every generated non-number", () => {
  fc.assert(fc.property(fc.oneof(fc.bigInt(), fc.jsonValue({ maxDepth: 2 }).filter(value => typeof value !== "number")), value => {
    const input = { pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [{ kind: "text", leftMm: 0, topMm: 0, widthMm: value, heightMm: 10 }] }] };
    expect(validateRenderPlan(input)).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: "$.pages.0.components.0.widthMm" })] });
  }), fuzzOptions(4));
});

it("random PNG/JPEG byte streams fail within media budgets with stable error codes", () => {
  fc.assert(fc.property(fc.uint8Array({ maxLength: 1024 }), fc.constantFrom("png", "PNG", "jpeg", "JPG"), (bytes, mime) => {
    const data = `data:image/${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    try {
      const image = createImageMediaInspector({ maxImageBytes: 1024, maxImagePixels: 64, maxImageDimension: 16 })(data);
      expect(image.width * image.height).toBeLessThanOrEqual(64); expect(image.bytes.length).toBeLessThanOrEqual(1024);
    } catch (error) {
      expect(error).toBeInstanceOf(ImageMediaError);
      expect(["invalid-image-data", "image-budget-exceeded"]).toContain((error as ImageMediaError).code);
    }
  }), fuzzOptions(5));
});

it("random short ZIP inputs reject without leaking decoder RangeErrors or allocating workbook cells", async () => {
  await fc.assert(fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async bytes => {
    const options = resolveImportOptions({ limits: { maxFileBytes: 1024, maxUncompressedBytes: 1024 } });
    try { await checkedExcelBytes(bytes, options, new ImportWarnings()); throw new Error("Random stream unexpectedly passed workbook preflight"); }
    catch (error) { expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(RangeError); expect((error as Error).message).toMatch(/Excel|工作簿|xlsx|ZIP/); }
  }), fuzzOptions(6));
});

it("mutated real ZIP headers and payloads stay inside preflight budgets", async () => {
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Mutation corpus").addRows([["000001", 0], ["000002", 2]]);
  const original = new Uint8Array(await workbook.xlsx.writeBuffer());
  const mutation = fc.array(fc.tuple(fc.integer({ min: 0, max: original.length - 1 }), fc.integer({ min: 1, max: 255 })), { minLength: 1, maxLength: 4 });
  await fc.assert(fc.asyncProperty(mutation, async edits => {
    const bytes = original.slice(); for (const [offset, xor] of edits) bytes[offset]! ^= xor;
    const options = resolveImportOptions({ limits: { maxFileBytes: 100_000, maxUncompressedBytes: 200_000 } });
    try { expect(await checkedExcelBytes(bytes, options, new ImportWarnings())).toEqual(bytes); }
    catch (error) { expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(RangeError); }
  }), fuzzOptions(8, 100));
}, 30_000);

it("cyclic and excessively deep component trees are rejected before recursive validation", () => {
  const component = { kind: "text", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 10, grid: { cells: [[{ children: [] as unknown[] }]] } };
  component.grid.cells[0]![0]!.children.push(component);
  expect(validateRenderPlan({ pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [component] }] }).ok).toBe(false);
  let nested: unknown = { kind: "text", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 10, text: "end" };
  for (let index = 0; index < 150; index++) nested = { kind: "text", leftMm: 0, topMm: 0, widthMm: 20, heightMm: 10, grid: { cells: [[{ children: [nested] }]] } };
  expect(validateRenderPlan({ pages: [{ pageWidthMm: 210, pageHeightMm: 297, components: [nested] }] }).ok).toBe(false);
});

it("real XLSX roundtrips generated scalar values, zero and leading-zero IDs", async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: -10_000, max: 10_000 }), { minLength: 1, maxLength: 10 }), async values => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Values");
    values.forEach((value, index) => sheet.addRow([String(index).padStart(5, "0"), value, index % 2 === 0]));
    const imported = await importExcelTemplate(new Uint8Array(await workbook.xlsx.writeBuffer()));
    const output = await renderPlanToXlsx(paginateTemplate(imported.template, {}).plan, { fidelity: "strict" });
    const read = new ExcelJS.Workbook(); await read.xlsx.load(output.buffer);
    values.forEach((value, index) => {
      expect(read.worksheets[0]!.getCell(index + 1, 1).value).toBe(String(index).padStart(5, "0"));
      expect(read.worksheets[0]!.getCell(index + 1, 2).value).toBe(value);
      expect(read.worksheets[0]!.getCell(index + 1, 3).value).toBe(index % 2 === 0);
    });
  }), fuzzOptions(7, 20));
}, 30_000);
