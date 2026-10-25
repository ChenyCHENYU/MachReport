import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  DatasetRows,
  ListComponent,
  RenderPlan,
  ReportTemplateDocument,
} from "../packages/mach-report/src/index";
interface ComplexFixture {
  readonly document: ReportTemplateDocument;
  readonly datasets: DatasetRows;
  readonly plan: RenderPlan;
}
declare global {
  interface Window { __complexFixture: ComplexFixture }
}
const coreUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`;
const designerUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/designer.ts", import.meta.url))}`;
const xlsxUrl = `/@fs${fileURLToPath(new URL("../packages/mach-report/src/xlsx.ts", import.meta.url))}`;
async function mountComplex(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  await page.evaluate(
    async ({ core, designer, xlsx }) => {
      const source = await fetch("/src/main.ts").then((response) =>
        response.text(),
      );
      const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
      if (!vueUrl) throw new Error("Missing shared Vue runtime");
      const { createApp, h, ref } = (await import(
        vueUrl
      )) as typeof import("vue");
      const { createTableTemplate, defineReportTemplate, paginateTemplate } =
        (await import(
          core
        )) as typeof import("../packages/mach-report/src/index");
      const { ReportTemplateEditor } = (await import(
        designer
      )) as typeof import("../packages/mach-report/src/designer");
      const datasets: DatasetRows = {
        detail: [
          {
            id: "M1",
            plant: "A",
            shift: "Day",
            base: "9007199254740993.01",
            quantity: 2,
            value: 0,
            weight: 1,
          },
          {
            id: "M2",
            plant: "A",
            shift: "Night",
            base: "0.11",
            quantity: 0,
            value: 10,
            weight: 3,
          },
          {
            id: "M3",
            plant: "B",
            shift: "Day",
            base: "2.01",
            quantity: 1,
            value: 20,
            weight: 2,
          },
        ],
        lines: [
          { lineId: "L1", masterId: "M1", qty: 0 },
          { lineId: "L2", masterId: "M1", qty: 4 },
          { lineId: "L3", masterId: "M2", qty: 1 },
        ],
      };
      const value = ref(
        defineReportTemplate({
          id: "complex-e2e",
          name: "复杂报表验收",
          template: createTableTemplate({
            layout: "wide",
            title: "复杂生产报表",
            dataset: "detail",
            listOptions: { rowKey: "id" },
            columns: [
              { field: "id", header: "订单", widthMm: 35 },
              { field: "plant", header: "厂区", widthMm: 28 },
              { field: "shift", header: "班组", widthMm: 28 },
              { field: "base", header: "原始金额", widthMm: 70 },
              { field: "quantity", header: "数量", widthMm: 28 },
              { field: "value", header: "指标", widthMm: 28 },
              { field: "weight", header: "权重", widthMm: 28 },
            ],
          }),
        }),
      );
      const target = document.createElement("div");
      target.id = "complex-designer-fixture";
      target.style.cssText =
        "position:fixed;inset:12px;z-index:9999;background:#fff";
      document.body.append(target);
      const exportExcel = async () => {
        const { renderPlanToXlsx } = (await import(
          xlsx
        )) as typeof import("../packages/mach-report/src/xlsx");
        const plan = paginateTemplate(value.value.template, datasets).plan;
        const list = value.value.template.pages[0]!.components.find(
          (component) => component.kind === "list",
        )!;
        const output = await renderPlanToXlsx(plan, {
          sheetMode: list.detail ? "pages" : "continuous",
          valueMode: "raw",
        });
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(output.buffer)], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "complex-report.xlsx";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      createApp({
        render: () =>
          h(
            "div",
            { style: "height:100%;display:flex;flex-direction:column;gap:6px" },
            [
              h(
                "button",
                {
                  type: "button",
                  style: "align-self:flex-end",
                  onClick: exportExcel,
                },
                "导出验证 Excel",
              ),
              h(ReportTemplateEditor, {
                style: "flex:1;min-height:0",
                modelValue: value.value,
                "onUpdate:modelValue": (next: ReportTemplateDocument) => {
                  value.value = next;
                },
                datasets,
                dataSchemas: {
                  detail: {
                    rowKey: "id",
                    fields: [
                      { field: "id", type: "text", label: "订单" },
                      { field: "plant", type: "text", label: "厂区" },
                      { field: "shift", type: "text", label: "班组" },
                      { field: "base", type: "decimal", label: "原始金额" },
                      { field: "quantity", type: "number", label: "数量" },
                      { field: "value", type: "number", label: "指标" },
                      { field: "weight", type: "number", label: "权重" },
                    ],
                  },
                  lines: {
                    rowKey: "lineId",
                    fields: [
                      { field: "lineId", type: "text", label: "明细行号" },
                      { field: "masterId", type: "text", label: "订单外键" },
                      { field: "qty", type: "number", label: "明细数量" },
                    ],
                  },
                },
                save: async (next: ReportTemplateDocument) => ({
                  ...next,
                  revision: "1",
                }),
              }),
            ],
          ),
      }).mount(target);
      window.__complexFixture = {
        get document() {
          return value.value;
        },
        get datasets() {
          return datasets;
        },
        get plan() {
          return paginateTemplate(value.value.template, datasets).plan;
        },
      };
    },
    { core: coreUrl, designer: designerUrl, xlsx: xlsxUrl },
  );
  const root = page.locator("#complex-designer-fixture");
  await expect(root.locator(".mr-designer-preview")).toContainText("M1");
  return { root, failures };
}
async function rules(root: Locator) {
  await root.getByRole("tab", { name: "工具", exact: true }).click();
  await root.getByRole("button", { name: "计算与规则", exact: true }).click();
  const editor = root.locator(".mr-rule-editor");
  await expect(editor).toBeVisible();
  return editor;
}
async function preview(root: Locator) {
  await root.getByRole("tab", { name: "字段", exact: true }).click();
  await root.getByRole("button", { name: "预览", exact: true }).click();
  await expect(
    root.locator(".mr-designer-preview .mrp-page-holder").first(),
  ).toBeVisible();
  await expect(root.locator(".mr-designer-preview [role=alert]")).toHaveCount(
    0,
  );
  return root.locator(".mr-designer-preview");
}
async function workbookValues(page: Page, root: Locator) {
  const downloaded = page.waitForEvent("download", {
    predicate: (download) =>
      download.suggestedFilename() === "complex-report.xlsx",
  });
  await root
    .getByRole("button", { name: "导出验证 Excel", exact: true })
    .click();
  const file = await downloaded;
  expect(await file.failure()).toBeNull();
  const bytes = await readFile((await file.path())!);
  return page.evaluate(
    async ({ bytes, xlsx }) => {
      const { importExcelTemplate } = (await import(
        xlsx
      )) as typeof import("../packages/mach-report/src/xlsx");
      const imported = await importExcelTemplate(new Uint8Array(bytes));
      return imported.template.pages.flatMap((page) =>
        page.components.flatMap((component) =>
          "grid" in component && component.grid
            ? component.grid.cells.flatMap((row) =>
                row.flatMap((cell) => (cell ? [cell.value] : [])),
              )
            : [],
        ),
      );
    },
    { bytes: Array.from(bytes), xlsx: xlsxUrl },
  );
}
async function currentList(page: Page): Promise<ListComponent> {
  return page.evaluate(
    () =>
      window.__complexFixture.document.template.pages[0]!.components.find(
        (component) => component.kind === "list",
      )!,
  );
}

test("规则工具实际配置精确小数公式与分组，预览/Excel一致并可撤销", async ({
  page,
}, info) => {
  const { root, failures } = await mountComplex(page),
    editor = await rules(root);
  await editor.getByLabel("结果字段", { exact: true }).fill("exact");
  await editor.getByLabel("数值模式", { exact: true }).selectOption("decimal");
  const expression = editor.locator(".mr-expression").first();
  await expression
    .locator(":scope > .mr-expression__row select")
    .first()
    .selectOption("operation");
  await expression.getByLabel("运算", { exact: true }).selectOption("add");
  const args = expression.locator(":scope > .mr-expression__argument");
  await args.nth(0).getByLabel("字段", { exact: true }).selectOption("base");
  await args
    .nth(1)
    .getByLabel("常量类型", { exact: true })
    .selectOption("text");
  await args.nth(1).getByLabel("常量", { exact: true }).fill("0.09");
  await editor.locator("summary").filter({ hasText: "计算边界" }).click();
  await editor.getByLabel("小数位", { exact: true }).fill("2");
  await editor.getByRole("button", { name: "样例验算", exact: true }).click();
  await expect(editor.locator(".mr-rule-editor__results")).toContainText(
    "9007199254740993.10",
  );
  await page.screenshot({ path: info.outputPath("rule-editor-calculation.png"), fullPage: true });
  await editor.getByRole("button", { name: "应用规则", exact: true }).click();
  await expect
    .poll(async () => (await currentList(page)).computed?.[0]?.field)
    .toBe("exact");
  await editor.getByRole("tab", { name: /^分组/ }).click();
  await editor.getByRole("button", { name: "+ 添加分组", exact: true }).click();
  await editor.getByLabel("字段", { exact: true }).selectOption("plant");
  await editor.getByLabel("组头模板", { exact: true }).fill("Plant {value}");
  await editor.getByRole("button", { name: "+ 添加聚合", exact: true }).click();
  await editor.getByLabel("输出字段", { exact: true }).selectOption("exact");
  await editor.getByLabel("聚合", { exact: true }).selectOption("sum");
  await editor.getByLabel("数值模式", { exact: true }).selectOption("decimal");
  await editor.getByRole("button", { name: "应用规则", exact: true }).click();
  await expect
    .poll(async () => (await currentList(page)).groups?.[0]?.field)
    .toBe("plant");
  const actual = await preview(root);
  await expect(actual).toContainText("Plant A");
  await expect(actual).toContainText("9007199254740993.10");
  const values = await workbookValues(page, root);
  expect(values).toContain("9007199254740993.10");
  // Raw Excel preserves the exact aggregate; display scale comes from the column format.
  expect(values).toContain("9007199254740993.3");
  expect(values).toContain(0);
  await root.getByRole("button", { name: "撤销", exact: true }).click();
  await expect
    .poll(async () => (await currentList(page)).groups)
    .toBeUndefined();
  await expect(actual).not.toContainText("Plant A");
  await expect(actual).toContainText("9007199254740993.10");
  await page.screenshot({
    path: info.outputPath("complex-formula-preview.png"),
    fullPage: true,
  });
  expect(failures).toEqual([]);
});

test("矩阵通过真实配置应用，动态列与零值导出正确且派生结果只读", async ({
  page,
}, info) => {
  const { root, failures } = await mountComplex(page),
    editor = await rules(root);
  await editor.getByRole("tab", { name: "矩阵", exact: true }).click();
  const matrix = editor.locator(".mr-data-layout");
  await matrix.getByLabel("启用矩阵", { exact: true }).check();
  await matrix
    .locator("fieldset")
    .filter({ has: page.locator("legend", { hasText: "行维度" }) })
    .getByLabel("厂区", { exact: true })
    .check();
  await matrix
    .locator("fieldset")
    .filter({ has: page.locator("legend", { hasText: "列维度" }) })
    .getByLabel("班组", { exact: true })
    .check();
  await matrix.getByRole("button", { name: "+ 添加聚合", exact: true }).click();
  await matrix.getByLabel("度量字段", { exact: true }).selectOption("value");
  await matrix.getByLabel("聚合", { exact: true }).selectOption("sum");
  await matrix.getByRole("button", { name: "样例验算", exact: true }).click();
  await expect(matrix.locator(".mr-data-layout__preview")).toContainText("Day");
  await matrix.getByRole("button", { name: "应用规则", exact: true }).click();
  await expect
    .poll(async () => (await currentList(page)).matrix?.rowFields)
    .toEqual(["plant"]);
  const actual = await preview(root);
  await expect(actual).toContainText("Day");
  await expect(actual).toContainText("Night");
  const state = await page.evaluate(() => {
    const fixture = window.__complexFixture;
    const body = fixture.plan.pages
      .flatMap((page) => page.components)
      .filter((component) => component.table?.role === "body");
    return {
      sources: body.map((component) => component.table!.source),
      editable: body.flatMap((component) =>
        component.grid!.cells.flatMap((row) =>
          row.map((cell) => cell?.editable),
        ),
      ),
      originalZero: fixture.datasets.detail![0]!.value,
    };
  });
  expect(state.sources.every((source) => source === undefined)).toBe(true);
  expect(state.editable.every((value) => value === false)).toBe(true);
  expect(state.originalZero).toBe(0);
  const zero = actual.locator("td").filter({ hasText: /^0$/ }).first();
  await zero.dblclick();
  await expect(actual.locator(".mrp-cell-editor")).toHaveCount(0);
  const values = await workbookValues(page, root);
  expect(values).toContain(0);
  expect(values).toContain(30);
  await root.getByRole("button", { name: "撤销", exact: true }).click();
  await expect
    .poll(async () => (await currentList(page)).matrix)
    .toBeUndefined();
  await expect(actual).toContainText("M1");
  await page.screenshot({
    path: info.outputPath("matrix-restored-preview.png"),
    fullPage: true,
  });
  expect(failures).toEqual([]);
});

test("层级矩阵从设计器配置排序与小计，真实预览合并表头并导出", async ({ page }, info) => {
  const { root, failures } = await mountComplex(page), editor = await rules(root);
  await editor.getByRole("tab", { name: "矩阵", exact: true }).click();
  const matrix = editor.locator(".mr-data-layout");
  await matrix.getByLabel("启用矩阵", { exact: true }).check();
  const dimensions = (name: string) => matrix.locator("fieldset").filter({ has: page.locator("legend", { hasText: name }) }).first();
  for (const field of ["厂区", "订单"]) await dimensions("行维度").getByLabel(field, { exact: true }).check();
  for (const field of ["班组", "数量"]) await dimensions("列维度").getByLabel(field, { exact: true }).check();
  await matrix.getByRole("button", { name: "+ 添加聚合", exact: true }).click();
  await matrix.getByLabel("度量字段", { exact: true }).selectOption("value");
  await matrix.locator("summary").filter({ hasText: "层级维度与小计" }).click();
  await matrix.getByLabel("启用", { exact: true }).check();
  await matrix.getByLabel("plant · 同级排序", { exact: true }).selectOption("desc");
  await matrix.getByLabel("此级小计", { exact: true }).first().check();
  await matrix.getByLabel("此级小计", { exact: true }).last().check();
  await matrix.getByRole("button", { name: "应用规则", exact: true }).click();
  await expect.poll(async () => (await currentList(page)).matrix?.hierarchy).toMatchObject({ row: { sort: ["desc", "source"], subtotals: [1] }, column: { subtotals: [1] } });
  const actual = await preview(root);
  await expect(actual).toContainText("小计");
  await expect(actual).toContainText("厂区");
  await expect(actual).toContainText("订单");
  await expect(actual).toContainText("指标（求和）");
  await expect(actual.locator('td[rowspan="3"]').first()).toBeVisible();
  const columns = await page.evaluate(() => window.__complexFixture.plan.pages.flatMap(page => page.components).find(component => component.table?.role === "header")!.meta!.matrix);
  expect(columns).toMatchObject({ columnFields: ["shift", "quantity"], rowFields: ["plant", "id"] });
  const values = await workbookValues(page, root);
  expect(values).toContain(0); expect(values).toContain(30); expect(values).toContain("小计");
  await page.screenshot({ path: info.outputPath("hierarchical-matrix-preview.png"), fullPage: true });
  expect(failures).toEqual([]);
});

test("主从配置按业务键关联，明细零值在预览/Excel保留并可完整撤销", async ({
  page,
}, info) => {
  const { root, failures } = await mountComplex(page),
    editor = await rules(root);
  await editor.getByRole("tab", { name: "主从", exact: true }).click();
  const detail = editor.locator(".mr-data-layout");
  await detail.getByLabel("启用主从", { exact: true }).check();
  await detail.getByLabel("明细数据集", { exact: true }).selectOption("lines");
  await detail.getByLabel("主表关联键", { exact: true }).selectOption("id");
  await detail.getByLabel("明细外键", { exact: true }).selectOption("masterId");
  await detail
    .getByLabel("明细业务主键", { exact: true })
    .selectOption("lineId");
  const choices = detail.locator("fieldset");
  await choices.getByLabel("明细行号", { exact: true }).check();
  await choices.getByLabel("明细数量", { exact: true }).check();
  await detail.getByRole("button", { name: "应用规则", exact: true }).click();
  await expect
    .poll(async () => (await currentList(page)).detail?.foreignKey)
    .toBe("masterId");
  const actual = await preview(root);
  await expect(actual).toContainText("L1");
  await expect(actual).toContainText("L3");
  const identities = await page.evaluate(() =>
    window.__complexFixture.plan.pages
      .flatMap((page) => page.components)
      .filter((component) => component.table?.role === "body")
      .map((component) => component.table!.source),
  );
  expect(identities.map((source) => source?.rowKey)).toEqual([
    "M1",
    "L1",
    "L2",
    "M2",
    "L3",
    "M3",
  ]);
  expect(identities[1]?.datasetId).toBe("lines");
  const values = await workbookValues(page, root);
  expect(values).toContain("L1");
  expect(values).toContain("L3");
  expect(values).toContain(0);
  await root.getByRole("button", { name: "撤销", exact: true }).click();
  await expect
    .poll(async () => (await currentList(page)).detail)
    .toBeUndefined();
  await expect(actual).not.toContainText("L1");
  await expect(actual).toContainText("M1");
  await page.screenshot({
    path: info.outputPath("detail-restored-preview.png"),
    fullPage: true,
  });
  expect(failures).toEqual([]);
});
