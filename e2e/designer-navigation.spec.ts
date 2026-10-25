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
  test(`${width}px 55列属性首屏可操作，按需目录保留键盘与物理列导航`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const root = await mountWideDesigner(page),
      rows = root.locator(".mr-designer-column-row"),
      trigger = root.locator(".mr-designer-field-trigger");
    await expect(rows).toHaveCount(0);
    await expect(root.locator(".mr-designer-properties")).toHaveCount(1);
    await expect(
      root.locator(".mr-designer-properties :is(input,select,[role=radiogroup]):not(.mr-column-visual *)"),
    ).toHaveCount(8);
    await expect(root.getByLabel("模板名称", { exact: true })).toHaveCount(0);
    await expect(root.getByLabel("完整模板 JSON", { exact: true })).toHaveCount(
      0,
    );
    await expect(root.getByLabel("批量正文对齐", { exact: true })).toHaveCount(
      0,
    );
    const geometries = [];
    for (const height of [800, 680]) {
      await page.setViewportSize({ width, height });
      const geometry = await root.evaluate((root) => {
        const bounds = (selector: string) =>
          root.querySelector(selector)!.getBoundingClientRect().toJSON();
        const panel = root.querySelector(".mr-designer-panel")!;
        const controls = [
          ...root.querySelectorAll(
            ".mr-designer-properties :is(input,select,[role=radiogroup]):not(.mr-column-visual *)",
          ),
        ];
        const propertyControls = controls.map((control) => {
          const rect = control.getBoundingClientRect();
          const target = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          return {
            bounds: rect.toJSON(),
            visible: target === control || control.contains(target),
          };
        });
        return {
          designer: bounds(".mr-designer"),
          header: bounds(".mr-designer-bar"),
          preview: bounds(".mr-designer-preview"),
          footer: bounds(".mrp-footer"),
          panel: bounds(".mr-designer-panel"),
          panelScroll: panel.scrollHeight - panel.clientHeight,
          propertyControls,
          scrollWidth: root.scrollWidth,
          width: root.clientWidth,
        };
      });
      geometries.push({ width, height, ...geometry });
      expect(geometry.header.height).toBe(42);
      expect(geometry.footer.bottom).toBeLessThanOrEqual(height - 15);
      expect(geometry.preview.height).toBeGreaterThan(height - 95);
      expect(geometry.panelScroll).toBeLessThanOrEqual(1);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
      for (const control of geometry.propertyControls) {
        expect(control.visible).toBe(true);
        expect(control.bounds.top).toBeGreaterThanOrEqual(geometry.panel.top);
        expect(control.bounds.bottom).toBeLessThanOrEqual(
          geometry.panel.bottom,
        );
      }
    }
    await trigger.click();
    await expect(rows).toHaveCount(55);
    await expect(
      root.getByLabel("搜索列名或字段", { exact: true }),
    ).toBeFocused();
    const first = rows.first().getByRole("button");
    await first.focus();
    await first.press("End");
    const last = rows.last().getByRole("button");
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c1",
    );
    await last.press("Enter");
    await expect(rows).toHaveCount(0);
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c55",
    );
    await trigger.click();
    // 多选只负责批量操作，不改变当前字段或关闭目录。
    await rows.nth(1).getByRole("checkbox").check();
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c55",
    );
    await expect(
      root.getByRole("dialog", { name: "字段目录", exact: true }),
    ).toBeVisible();
    await root
      .getByLabel("批量正文对齐", { exact: true })
      .selectOption("center");
    await root
      .getByRole("button", { name: "关闭字段目录", exact: true })
      .click();
    await expect(trigger).toBeFocused();
    await expect(rows).toHaveCount(0);
    await trigger.click();
    await expect(rows.nth(1).getByRole("checkbox")).toBeChecked();
    await expect(last).toBeInViewport({ ratio: 1 });
    await last.press("Enter");
    await expect(rows).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c55",
    );
    await root.getByRole("button", { name: "撤销", exact: true }).click();
    // 正向 Tab 离开目录不会把焦点留在被覆盖的属性中，也不强制返回入口。
    await trigger.click();
    await last.focus();
    await last.press("Tab");
    await expect(rows).toHaveCount(0);
    await expect(trigger).not.toBeFocused();
    // 反向 Tab 允许回到属性，但此时必须先收起覆盖目录。
    await trigger.click();
    const focusedSearch = root.getByLabel("搜索列名或字段", { exact: true });
    await focusedSearch.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(
      root.getByRole("checkbox", { name: "显示此列", exact: true }),
    ).toBeFocused();
    await expect(rows).toHaveCount(0);
    await root.getByRole("tab", { name: "模板", exact: true }).click();
    await expect(
      root.getByRole("heading", { name: "模板信息", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(root.locator(".mr-designer-technical")).not.toHaveAttribute(
      "open",
    );
    const fieldsTab = root.getByRole("tab", { name: "字段", exact: true });
    await fieldsTab.click();
    await expect(fieldsTab).toBeFocused();
    await expect(rows).toHaveCount(0);
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c55",
    );
    expect(await root.evaluate((element) => element.scrollTop)).toBe(0);
    await root.getByRole("tab", { name: "高级", exact: true }).click();
    await expect(
      root.getByRole("heading", { name: "完整配置", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      root.getByLabel("完整模板 JSON", { exact: true }),
    ).toBeVisible();
    await fieldsTab.click();
    await trigger.click();
    const search = root.getByLabel("搜索列名或字段", { exact: true });
    await search.fill("c54");
    await expect(rows).toHaveCount(1);
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c55",
    );
    await search.press("Enter");
    await expect(rows).toHaveCount(0);
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
    // 关闭目录后的前后切换走完整物理列，保留目录查询也不能跳到错误字段。
    await root.getByRole("button", { name: "下一字段", exact: true }).click();
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c55",
    );
    await root.getByRole("button", { name: "上一字段", exact: true }).click();
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c54",
    );
    await trigger.click();
    await expect(search).toHaveValue("c54");
    await search.fill("不存在的字段");
    await expect(
      root.getByText("没有匹配的列", { exact: true }).last(),
    ).toBeVisible();
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c54",
    );
    await search.press("Enter");
    await expect(
      root.getByRole("dialog", { name: "字段目录", exact: true }),
    ).toBeVisible();
    await expect(root.getByLabel("业务字段", { exact: true })).toHaveValue(
      "c54",
    );
    await expect(root.locator(".mr-designer-properties")).toHaveCount(1);
    await root.getByRole("button", { name: "清除搜索", exact: true }).click();
    await expect(rows).toHaveCount(55);
    await expect(root.locator(".mr-designer-properties")).toHaveCount(1);
    await search.fill("业务指标55");
    await rows.first().getByRole("button").press("Enter");
    const header = root.getByLabel("表头", { exact: true });
    await header.focus();
    await header.press("ControlOrMeta+A");
    await header.pressSequentially("持续输入后的完整名称");
    await expect(header).toBeFocused();
    await expect(header).toHaveValue("持续输入后的完整名称");
    // Escape 只关闭字段目录并还焦，不传播到宿主弹窗。
    await page.evaluate(() => {
      (window as Window & { __escaped?: number }).__escaped = 0;
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape")
          (window as Window & { __escaped?: number }).__escaped!++;
      });
    });
    await trigger.click();
    await search.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(rows).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as Window & { __escaped?: number }).__escaped,
      ),
    ).toBe(0);
    await trigger.click();
    await root.getByRole("tab", { name: "模板", exact: true }).click();
    await expect(
      root.getByRole("tab", { name: "模板", exact: true }),
    ).toBeFocused();
    await fieldsTab.click();
    await expect(rows).toHaveCount(0);
    await fieldsTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      root.getByRole("tab", { name: "组件", exact: true }),
    ).toBeFocused();
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
    await fieldsTab.click();
    await page.setViewportSize({ width, height: 800 });
    await testInfo.attach("workbench-layout.json", {
      body: JSON.stringify(geometries, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: testInfo.outputPath(`designer-wide-${width}.png`),
      fullPage: true,
    });
  });
}
