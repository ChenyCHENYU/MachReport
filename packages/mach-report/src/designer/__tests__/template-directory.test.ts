import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { ListComponent } from "../../index";
import { useTemplateDirectory } from "../useTemplateDirectory";
import { useTemplateInspector } from "../useTemplateInspector";

function harness() {
  const query = ref("");
  const list = ref<ListComponent>({
    kind: "list",
    leftMm: 0,
    topMm: 0,
    widthMm: 1100,
    dataset: "detail",
    columns: Array.from({ length: 55 }, (_, index) => ({
      header: `指标${index + 1}`,
      field: `c${index + 1}`,
      widthMm: 20,
    })),
  });
  const visible = computed(() =>
    list.value.columns.flatMap((column, index) =>
      `${column.header} ${column.field}`.includes(query.value)
        ? [{ column, index }]
        : [],
    ),
  );
  const inspector = useTemplateInspector(ref(0), list);
  let directory!: ReturnType<typeof useTemplateDirectory>;
  const escaped = vi.fn();
  const wrapper = mount(
    defineComponent({
      setup() {
        directory = useTemplateDirectory(inspector, inspector.section, visible);
        return () =>
          h("div", { onKeydown: escaped }, [
            h(
              "button",
              { ref: directory.trigger, onClick: directory.toggle },
              "目录",
            ),
            h("button", { class: "outside" }, "外部操作"),
            directory.open.value
              ? h(
                  "div",
                  {
                    ref: directory.panel,
                    onKeydown: (event: KeyboardEvent) => {
                      if (event.key === "Escape") directory.escape(event);
                    },
                    onFocusout: directory.leave,
                  },
                  [
                    h("input", { ref: directory.search }),
                    h(
                      "div",
                      { ref: directory.list },
                      visible.value.map(({ index }) =>
                        h(
                          "button",
                          {
                            "data-column-index": index,
                            onKeydown: directory.navigate,
                            onClick: () => directory.choose(index),
                          },
                          String(index),
                        ),
                      ),
                    ),
                  ],
                )
              : null,
          ]);
      },
    }),
    { attachTo: document.body },
  );
  return {
    wrapper,
    query,
    inspector,
    escaped,
    get directory() {
      return directory;
    },
  };
}

describe("按需字段目录", () => {
  it("搜索与方向键只是候选，提交后才切换55列真实物理索引", async () => {
    const { wrapper, query, inspector, directory } = harness();
    await directory.toggle();
    expect(document.activeElement).toBe(directory.search.value);
    query.value = "c5";
    await nextTick();
    expect(directory.cursor.value).toBe(4);
    await directory.navigate(
      new KeyboardEvent("keydown", { key: "End", cancelable: true }),
    );
    expect(directory.cursor.value).toBe(54);
    expect(inspector.activeIndex.value).toBe(0);
    expect(document.activeElement?.getAttribute("data-column-index")).toBe(
      "54",
    );
    directory.choose(54);
    await nextTick();
    expect(inspector.activeColumn.value?.column.field).toBe("c55");
    expect(directory.open.value).toBe(false);
    expect(document.activeElement).toBe(directory.trigger.value);
    wrapper.unmount();
  });
  it("无匹配搜索取消不改变原字段，Esc局部收起并还焦，重开保留查询", async () => {
    const { wrapper, query, inspector, directory, escaped } = harness();
    inspector.activate(54);
    await directory.toggle();
    query.value = "missing";
    await nextTick();
    expect(directory.cursor.value).toBe(-1);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    directory.search.value!.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(escaped).not.toHaveBeenCalled();
    expect(inspector.activeIndex.value).toBe(54);
    expect(document.activeElement).toBe(directory.trigger.value);
    await directory.toggle();
    expect(query.value).toBe("missing");
    expect(directory.cursor.value).toBe(-1);
    query.value = "";
    await nextTick();
    await directory.close();
    await directory.toggle();
    expect(directory.cursor.value).toBe(54);
    wrapper.unmount();
  });
  it("外部点击、焦点离开与分区切换收起目录并保留新焦点和当前字段", async () => {
    const { wrapper, query, inspector, directory } = harness();
    inspector.activate(53);
    await directory.toggle();
    query.value = "c5";
    await nextTick();
    const outside = wrapper.get(".outside").element as HTMLButtonElement;
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    outside.focus();
    await nextTick();
    expect(directory.open.value).toBe(false);
    expect(document.activeElement).toBe(outside);
    expect(inspector.activeIndex.value).toBe(53);
    await directory.toggle();
    directory.search.value!.focus();
    outside.focus();
    await nextTick();
    expect(directory.open.value).toBe(false);
    expect(document.activeElement).toBe(outside);
    await directory.toggle();
    inspector.section.value = "template";
    await nextTick();
    expect(directory.open.value).toBe(false);
    expect(query.value).toBe("c5");
    expect(inspector.activeIndex.value).toBe(53);
    wrapper.unmount();
  });
  it("搜索框方向键进入候选，Enter提交，零结果Enter保留当前字段与目录", async () => {
    const { wrapper, query, inspector, directory } = harness();
    await directory.toggle();
    query.value = "c54";
    await nextTick();
    await directory.searchKeydown(
      new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }),
    );
    expect(document.activeElement?.getAttribute("data-column-index")).toBe(
      "53",
    );
    expect(inspector.activeIndex.value).toBe(0);
    await directory.searchKeydown(
      new KeyboardEvent("keydown", { key: "Enter", cancelable: true }),
    );
    await nextTick();
    expect(inspector.activeColumn.value?.column.field).toBe("c54");
    expect(directory.open.value).toBe(false);
    await directory.toggle();
    query.value = "missing";
    await nextTick();
    await directory.searchKeydown(
      new KeyboardEvent("keydown", { key: "Enter", cancelable: true }),
    );
    expect(inspector.activeIndex.value).toBe(53);
    expect(directory.open.value).toBe(true);
    query.value = "";
    await nextTick();
    await directory.searchKeydown(
      new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true }),
    );
    expect(document.activeElement?.getAttribute("data-column-index")).toBe(
      "54",
    );
    const editKey = new KeyboardEvent("keydown", {
      key: "Home",
      cancelable: true,
    });
    await directory.searchKeydown(editKey);
    expect(editKey.defaultPrevented).toBe(false);
    wrapper.unmount();
  });
  it("卸载移除全局点击监听，避免已卸载目录继续响应宿主", async () => {
    const { wrapper, directory } = harness();
    await directory.toggle();
    wrapper.unmount();
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(directory.open.value).toBe(true);
  });
});
