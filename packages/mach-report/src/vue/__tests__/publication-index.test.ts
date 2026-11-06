import { afterEach, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createReportSource, createTableTemplate } from "../../index";
import ReportPreview from "../ReportPreview.vue";
import type { MachReportController } from "../controller";
import * as addresses from "../composables/edit-recalculation";

const wrappers: VueWrapper[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks(); document.body.replaceChildren(); });
it("shares one publication address index across selection restoration, differences and Enter navigation", async () => {
  const template = createTableTemplate({ columns: [{ field: "id", header: "ID" }, { field: "note", header: "Note" }], listOptions: { rowKey: "id" } });
  const fetcher = createReportSource({ report: { template, datasets: { detail: [{ id: "001", note: "before" }, { id: "002", note: "next" }] } } });
  const wrapper = mount(ReportPreview, { props: { reportId: "report", fetcher, editable: true, guardChanges: false, showExport: false, showPrint: false, showPdfWindow: false }, attachTo: document.body }); wrappers.push(wrapper);
  await vi.waitFor(() => expect(wrapper.text()).toContain("before"));
  const report = wrapper.vm as unknown as MachReportController;
  const cell = wrapper.findAll("td").find(cell => cell.text() === "before")!;
  await cell.trigger("click"); await cell.trigger("dblclick");
  const input = wrapper.get(".mrp-cell-editor"); await input.setValue("after");
  const spy = vi.spyOn(addresses, "createEditAddressResolver");
  await input.trigger("keydown", { key: "Enter" });
  await vi.waitFor(() => expect(wrapper.findAll("td").some(cell => cell.text() === "after")).toBe(true));
  expect(report.getDifferences?.()).toHaveLength(1);
  await vi.waitFor(() => expect(report.getSelection?.()?.focus).toBeTruthy());
  expect(spy).toHaveBeenCalledTimes(1);
  await report.reload();
  expect(report.getDifferences?.()).toHaveLength(0);
});
