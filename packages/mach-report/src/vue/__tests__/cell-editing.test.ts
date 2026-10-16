// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { GridCell, RenderPlan, ReportCellEdit } from "@agile-team/mach-report";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";
import type { ReportEditingOptions } from "../editing";

const mounted = new Set<VueWrapper>();
afterEach(() => {
  for (const wrapper of mounted) wrapper.unmount();
  mounted.clear();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function sourcePlan(): RenderPlan {
  return { schemaVersion: "editing", pages: [{
    pageWidthMm: 210, pageHeightMm: 100, components: [{
      kind: "rect", leftMm: 10, topMm: 10, widthMm: 120, heightMm: 12,
      grid: { colWidthsMm: [30, 30, 30, 30], cells: [[
        { value: 5, text: "5.00", numberFormat: "0.00" },
        { value: "00123", text: "00123" },
        { value: null, text: "", valueType: "number" },
        { value: 10, text: "10", formula: "A1*2" }
      ]] }
    }]
  }] };
}

function controller(wrapper: VueWrapper): MachReportController {
  return wrapper.vm as unknown as MachReportController;
}

function values(wrapper: VueWrapper): GridCell[] {
  return controller(wrapper).getPlan!()!.pages[0]!.components[0]!.grid!.cells[0] as GridCell[];
}

async function mountReport(editable?: boolean | ReportEditingOptions) {
  const original = sourcePlan();
  const fetcher = vi.fn().mockResolvedValue(original);
  const onError = vi.fn();
  const onCellEdit = vi.fn();
  const wrapper = mount(ReportPreview, {
    props: { reportId: "A", fetcher, editable, onError, "onCell-edit": onCellEdit },
    attachTo: document.body
  });
  mounted.add(wrapper);
  await vi.waitFor(() => expect(wrapper.findAll("td[data-mr-row-index]")).toHaveLength(4));
  return { wrapper, original, fetcher, onError, onCellEdit };
}

async function begin(wrapper: VueWrapper, columnIndex = 0): Promise<HTMLTextAreaElement> {
  await wrapper.find(`td[data-mr-column-index="${columnIndex}"]`).trigger("dblclick");
  await vi.waitFor(() => expect(wrapper.find("textarea.mrp-cell-editor").exists()).toBe(true));
  return wrapper.find("textarea.mrp-cell-editor").element as HTMLTextAreaElement;
}

async function enter(input: HTMLTextAreaElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flushPromises();
}

function unmount(wrapper: VueWrapper): void {
  wrapper.unmount();
  mounted.delete(wrapper);
}

describe("ReportPreview optional cell editing", () => {
  it("defaults off and disabling the prop cancels the active editor", async () => {
    const { wrapper, onCellEdit } = await mountReport();
    await wrapper.find("td").trigger("dblclick");
    expect(wrapper.find("textarea.mrp-cell-editor").exists()).toBe(false);
    await wrapper.setProps({ editable: true });
    const input = await begin(wrapper);
    input.value = "99";
    await wrapper.setProps({ editable: false });
    expect(wrapper.find("textarea.mrp-cell-editor").exists()).toBe(false);
    expect(values(wrapper)[0]!.value).toBe(5);
    expect(onCellEdit).not.toHaveBeenCalled();
    expect(controller(wrapper).getChanges!()).toEqual([]);
  });

  it("commits typed zero, IDs and cleared numbers while preserving the host source", async () => {
    const { wrapper, original, onCellEdit } = await mountReport(true);
    await enter(await begin(wrapper), "0");
    await vi.waitFor(() => expect(values(wrapper)[0]).toMatchObject({ value: 0, text: "0.00" }));
    await enter(await begin(wrapper, 1), "00009");
    await vi.waitFor(() => expect(values(wrapper)[1]!.value).toBe("00009"));
    await enter(await begin(wrapper, 2), "12.5");
    await vi.waitFor(() => expect(values(wrapper)[2]!.value).toBe(12.5));
    await enter(await begin(wrapper, 2), "");
    await vi.waitFor(() => expect(values(wrapper)[2]).toMatchObject({ value: null, text: "" }));
    expect(original.pages[0]!.components[0]!.grid!.cells[0]![0]!.value).toBe(5);
    expect(onCellEdit).toHaveBeenCalledTimes(4);
    const changes = controller(wrapper).getChanges!();
    expect(changes.map((edit) => edit.value)).toEqual([0, "00009", 12.5, null]);
    changes[0]!.value = 100;
    const copy = controller(wrapper).getPlan!()!;
    copy.pages[0]!.components[0]!.grid!.cells[0]![0]!.value = 100;
    expect(controller(wrapper).getChanges!()[0]!.value).toBe(0);
    expect(values(wrapper)[0]!.value).toBe(0);
  });

  it("rejects invalid numbers and host validation without changing the plan", async () => {
    const validate = vi.fn((edit: Readonly<ReportCellEdit>) => edit.value === 0 ? "数量必须大于零" : undefined);
    const save = vi.fn();
    const { wrapper, onError } = await mountReport({ validate, save });
    const input = await begin(wrapper);
    await enter(input, "oops");
    expect(values(wrapper)[0]!.value).toBe(5);
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(validate).not.toHaveBeenCalled();
    await enter(input, "0");
    expect(onError.mock.calls.at(-1)![0]).toBe("数量必须大于零");
    expect(save).not.toHaveBeenCalled();
    expect(values(wrapper)[0]!.value).toBe(5);
    await enter(input, "2");
    await vi.waitFor(() => expect(values(wrapper)[0]!.value).toBe(2));
    expect(save).toHaveBeenCalledOnce();
  });

  it("leaves the report untouched on save rejection, supports retry and deduplicates Enter", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("已封月，禁止修改")).mockResolvedValue(undefined);
    const { wrapper, onCellEdit, onError } = await mountReport({ save });
    const input = await begin(wrapper);
    await enter(input, "8");
    expect(onError.mock.calls.at(-1)![0]).toBe("已封月，禁止修改");
    expect(values(wrapper)[0]!.value).toBe(5);
    expect(controller(wrapper).getChanges!()).toEqual([]);
    expect(input.disabled).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(values(wrapper)[0]!.value).toBe(8));
    expect(save).toHaveBeenCalledTimes(2);
    expect(onCellEdit).toHaveBeenCalledOnce();
  });

  it("supports Escape cancellation and canEdit without enabling formula cells", async () => {
    const canEdit = vi.fn((context) => context.address.columnIndex !== 1);
    const { wrapper, onCellEdit } = await mountReport({ canEdit });
    await wrapper.find('td[data-mr-column-index="1"]').trigger("dblclick");
    await flushPromises();
    expect(wrapper.find("textarea.mrp-cell-editor").exists()).toBe(false);
    await wrapper.find('td[data-mr-column-index="3"]').trigger("dblclick");
    await flushPromises();
    expect(wrapper.find("textarea.mrp-cell-editor").exists()).toBe(false);
    const input = await begin(wrapper);
    input.value = "123";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(wrapper.find("textarea.mrp-cell-editor").exists()).toBe(false);
    expect(values(wrapper)[0]!.value).toBe(5);
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it("rechecks reactive permissions before validation and persistence", async () => {
    let allowed = true;
    let validateDone!: () => void;
    const validate = vi.fn(() => new Promise<void>((resolve) => { validateDone = resolve; }));
    const save = vi.fn();
    const { wrapper, onError } = await mountReport({ canEdit: () => allowed, validate, save });
    const input = await begin(wrapper);
    allowed = false;
    await enter(input, "8");
    expect(validate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(values(wrapper)[0]!.value).toBe(5);
    allowed = true;
    await enter(input, "8");
    expect(validate).toHaveBeenCalledOnce();
    allowed = false;
    validateDone();
    await flushPromises();
    expect(save).not.toHaveBeenCalled();
    expect(values(wrapper)[0]!.value).toBe(5);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("replacing editing options cancels an old callback and allows the new configuration", async () => {
    let saveDone!: () => void;
    let signal!: AbortSignal;
    const save = vi.fn((_edit, operation) => {
      signal = operation.signal;
      return new Promise<void>((resolve) => { saveDone = resolve; });
    });
    const { wrapper, onError, onCellEdit } = await mountReport({ save });
    await enter(await begin(wrapper), "99");
    const replacement = vi.fn();
    await wrapper.setProps({ editable: { save: replacement } });
    expect(signal.aborted).toBe(true);
    saveDone();
    await flushPromises();
    expect(values(wrapper)[0]!.value).toBe(5);
    expect(onCellEdit).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    await enter(await begin(wrapper), "8");
    await vi.waitFor(() => expect(values(wrapper)[0]!.value).toBe(8));
    expect(replacement).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
  });

  it("does not apply a completed save after permissions were revoked", async () => {
    let allowed = true;
    let saveDone!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => { saveDone = resolve; }));
    const { wrapper, onCellEdit, onError } = await mountReport({ canEdit: () => allowed, save });
    await enter(await begin(wrapper), "8");
    allowed = false;
    saveDone();
    await flushPromises();
    expect(values(wrapper)[0]!.value).toBe(5);
    expect(onCellEdit).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });

  it.each(["reload", "disable", "escape", "unmount"] as const)("%s aborts pending saves; late success/rejection cannot alter state or emit", async (action) => {
    let resolve!: () => void;
    let reject!: (cause: Error) => void;
    let signal!: AbortSignal;
    const save = vi.fn((_edit, operation) => {
      signal = operation.signal;
      return new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    });
    const { wrapper, onCellEdit, onError } = await mountReport({ save });
    const input = await begin(wrapper);
    await enter(input, "99");
    expect(save).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(false);
    if (action === "reload") { await wrapper.setProps({ guardChanges: false }); await controller(wrapper).reload(); }
    else if (action === "disable") await wrapper.setProps({ editable: false });
    else if (action === "escape") input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else unmount(wrapper);
    expect(signal.aborted).toBe(true);
    if (action === "disable") reject(new Error("迟到的权限拒绝"));
    else resolve();
    await flushPromises();
    expect(onCellEdit).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    if (action !== "unmount") {
      expect(values(wrapper)[0]!.value).toBe(5);
      expect(controller(wrapper).getChanges!()).toEqual([]);
      expect(wrapper.find("textarea.mrp-cell-editor").exists()).toBe(false);
    }
  });
});
