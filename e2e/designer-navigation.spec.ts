import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { ReportTemplateDocument } from "../packages/mach-report/src/index";
import type { TemplateEditorController } from "../packages/mach-report/src/designer";

type FixtureWindow = Window & {
  __templateWorkbench: {
    readonly controller: TemplateEditorController | undefined;
    readonly document: ReportTemplateDocument;
    completeSave(): void;
    setReadonly(value: boolean): void;
  };
};

async function mountWideDesigner(page: Page) {
  await page.goto("http://localhost:8610");
  await expect(page.getByText("产品出库单")).toBeVisible();
  const urls = {
    core: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/index.ts", import.meta.url))}`,
    designer: `/@fs${fileURLToPath(new URL("../packages/mach-report/src/designer.ts", import.meta.url))}`,
  };
  await page.evaluate(async ({ core, designer }) => {
    const source = await fetch("/src/main.ts").then((response) =>
      response.text(),
    );
    const vueUrl = source.match(/from ["']([^"']*\/vue\.js[^"']*)["']/)?.[1];
    if (!vueUrl) throw new Error("Missing shared Vue runtime");
    const { createApp, h, ref } = (await import(
      vueUrl
    )) as typeof import("vue");
    const { createTableTemplate, defineReportTemplate } = (await import(
      core
    )) as typeof import("../packages/mach-report/src/index");
    const { ReportTemplateEditor } = (await import(
      designer
    )) as typeof import("../packages/mach-report/src/designer");
    const columns = Array.from({ length: 55 }, (_, index) => ({
      header: `业务指标${index + 1}`,
      field: `c${index + 1}`,
      widthMm: 26,
    }));
    const documentValue = ref(
      defineReportTemplate({
        id: "wide-inspector",
        name: "55列模板验收",
        revision: "1",
        template: createTableTemplate({
          layout: "wide",
          title: "55列完整宽表",
          columns,
        }),
      }),
    );
    const controller = ref<TemplateEditorController>(),
      readonly = ref(false);
    let completeSave: (() => void) | undefined;
    const target = document.createElement("div");
    target.id = "wide-designer-fixture";
    target.style.cssText = "position:fixed;inset:16px;z-index:9999";
    document.body.append(target);
    createApp({
      render: () =>
        h(ReportTemplateEditor, {
          ref: controller,
          modelValue: documentValue.value,
          readonly: readonly.value,
          "onUpdate:modelValue": (value: ReportTemplateDocument) => {
            documentValue.value = value;
          },
          datasets: {
            detail: [
              Object.fromEntries(
                columns.map((column, index) => [column.field, index]),
              ),
            ],
          },
          save: async (draft: ReportTemplateDocument) => {
            await new Promise<void>((resolve) => {
              completeSave = resolve;
            });
            return { ...draft, revision: "2" };
          },
        }),
    }).mount(target);
    (window as FixtureWindow).__templateWorkbench = {
      get controller() {
        return controller.value;
      },
      get document() {
        return documentValue.value;
      },
      completeSave() {
        completeSave?.();
      },
      setReadonly(value) {
        readonly.value = value;
      },
    };
  }, urls);
  const root = page.locator("#wide-designer-fixture");
  await expect(
    root.locator(".mr-designer-preview .mrp-page-holder"),
  ).toBeVisible();
  return root;
}

for (const width of [1024, 1440]) {
  test(`${width}px 55列使用单列属性，目录键盘导航及预览分页保持可见`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const root = await mountWideDesigner(page),
      rows = root.locator(".mr-designer-column-row");
    await expect(rows).toHaveCount(55);
    await expect(root.locator("fieldset")).toHaveCount(1);
    await expect(root.locator("fieldset input,fieldset select")).toHaveCount(7);
    await expect(root.getByLabel("模板名称", { exact: true })).toHaveCount(0);
    await expect(root.getByLabel("完整模板 JSON", { exact: true })).toHaveCount(
      0,
    );
    await expect(root.getByLabel("批量正文对齐", { exact: true })).toHaveCount(
      0,
    );
    const geometry = await root.evaluate((root) => {
      const bounds = (selector: string) =>
        root.querySelector(selector)!.getBoundingClientRect().toJSON();
      const directory = root
        .querySelector(".mr-designer-column-list")!
        .getBoundingClientRect();
      const visibleRows = [
        ...root.querySelectorAll(".mr-designer-column-row"),
      ].filter(
        (row) =>
          row.getBoundingClientRect().bottom <= directory.bottom &&
          row.getBoundingClientRect().top >= directory.top,
      ).length;
      return {
        designer: bounds(".mr-designer"),
        preview: bounds(".mr-designer-preview"),
        footer: bounds(".mrp-footer"),
        directory: bounds(".mr-designer-column-list"),
        visibleRows,
        scrollWidth: root.scrollWidth,
        width: root.clientWidth,
      };
    });
    expect(geometry.visibleRows).toBeGreaterThanOrEqual(6);
    expect(geometry.footer.bottom).toBeLessThanOrEqual(800 - 15);
    expect(geometry.preview.height).toBeGreaterThan(500);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
    const first = rows.first().getByRole("button");
    await first.focus();
    await first.press("End");
    await expect(rows.last().getByRole("button")).toBeFocused();
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c55",
    );
    await root.getByRole("tab", { name: "模板", exact: true }).click();
    const fieldsTab = root.getByRole("tab", { name: "字段", exact: true });
    await fieldsTab.click();
    await expect(fieldsTab).toBeFocused();
    await expect(rows.last().getByRole("button")).toBeInViewport({ ratio: 1 });
    await expect(rows.last().getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue("c55");
    expect(await root.evaluate((element) => element.scrollTop)).toBe(0);
    await root.getByLabel("搜索列名或字段", { exact: true }).fill("c54");
    await expect(rows).toHaveCount(1);
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c54",
    );
    await root.getByLabel("表头", { exact: true }).fill("精准字段54");
    expect(
      await page.evaluate(() => {
        const list = (
          window as FixtureWindow
        ).__templateWorkbench.document.template.pages[0]!.components.find(
          (component) => component.kind === "list",
        );
        return list?.kind === "list"
          ? [list.columns[53]!.header, list.columns[54]!.header]
          : [];
      }),
    ).toEqual(["精准字段54", "业务指标55"]);
    await root
      .getByLabel("搜索列名或字段", { exact: true })
      .fill("不存在的字段");
    await expect(root.getByText("没有匹配的列", { exact: true })).toBeVisible();
    await expect(root.locator("fieldset")).toHaveCount(0);
    await root.getByRole("button", { name: "清除搜索", exact: true }).click();
    await expect(rows).toHaveCount(55);
    await expect(root.locator("fieldset")).toHaveCount(1);
    await root.getByLabel("搜索列名或字段", { exact: true }).fill("业务指标55");
    const header = root.getByLabel("表头", { exact: true });
    await header.focus();
    await header.press("ControlOrMeta+A");
    await header.pressSequentially("持续输入后的完整名称");
    await expect(header).toBeFocused();
    await expect(header).toHaveValue("持续输入后的完整名称");
    await root.getByRole("button", { name: "清除搜索", exact: true }).click();
    await root.getByRole("tab", { name: "字段", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      root.getByRole("tab", { name: "模板", exact: true }),
    ).toBeFocused();
    await root.getByLabel("模板名称", { exact: true }).fill("收敛后的55列模板");
    await page.evaluate(() =>
      (window as FixtureWindow).__templateWorkbench.setReadonly(true),
    );
    await expect(root.getByLabel("模板名称", { exact: true })).toBeDisabled();
    await page.evaluate(() =>
      (window as FixtureWindow).__templateWorkbench.setReadonly(false),
    );
    await root.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          saving: (window as FixtureWindow).__templateWorkbench.controller
            ?.saving,
          blocked: (window as FixtureWindow).__templateWorkbench.controller
            ?.blocked,
        })),
      )
      .toEqual({ saving: true, blocked: true });
    await expect(root.getByLabel("模板名称", { exact: true })).toBeDisabled();
    await page.evaluate(() =>
      (window as FixtureWindow).__templateWorkbench.completeSave(),
    );
    await expect
      .poll(() =>
        page.evaluate(() => ({
          saving: (window as FixtureWindow).__templateWorkbench.controller
            ?.saving,
          blocked: (window as FixtureWindow).__templateWorkbench.controller
            ?.blocked,
          dirty: (window as FixtureWindow).__templateWorkbench.controller
            ?.pendingLocalChanges,
        })),
      )
      .toEqual({ saving: false, blocked: false, dirty: false });
    await root.getByRole("tab", { name: "字段", exact: true }).click();
    await testInfo.attach("workbench-layout.json", {
      body: JSON.stringify(geometry, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: testInfo.outputPath(`designer-wide-${width}.png`),
      fullPage: true,
    });
  });
}
