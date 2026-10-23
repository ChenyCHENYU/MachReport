// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePrintResources, ReportPrintResourceError, printResourceMessage } from "../print-resources";
import { buildPrintDocument, printPlans } from "../composables/usePrintExport";
import { createPrintCalibrationPlan } from "../print-calibration";
import { printCalibration } from "../print-options";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function doc() { return document.implementation.createHTMLDocument("print"); }
function image(document: Document, decode: () => Promise<void>, width = 1) {
  const img = document.createElement("img"); img.src = "data:image/png;base64,AA==";
  Object.defineProperties(img, { decode: { value: decode }, naturalWidth: { value: width }, naturalHeight: { value: width } });
  document.body.append(img); return img;
}
describe("physical print resource preparation", () => {
  it("awaits the print document's font set and image decoding instead of a single event-loop yield", async () => {
    const document = doc(), fonts = deferred<unknown>(), decoded = deferred<void>(), decode = vi.fn(() => decoded.promise);
    Object.defineProperty(document, "fonts", { value: { ready: fonts.promise }, configurable: true });
    image(document, decode);
    const done = vi.fn(); const pending = preparePrintResources(document).then(done);
    await Promise.resolve(); expect(decode).not.toHaveBeenCalled();
    fonts.resolve(undefined); await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce()); expect(done).not.toHaveBeenCalled();
    decoded.resolve(); await pending; expect(done).toHaveBeenCalledOnce();
  });
  it("rejects broken images and reports a safe image identity", async () => {
    const document = doc(); image(document, () => Promise.reject(new Error("secret URL")));
    await expect(preparePrintResources(document)).rejects.toMatchObject({ code: "print-resource", kind: "image", resource: 1 });
    expect(printResourceMessage(new ReportPrintResourceError("image", 1))).toContain("第 1 张图片");
    const zero = doc(); image(zero, () => Promise.resolve(), 0);
    await expect(preparePrintResources(zero)).rejects.toMatchObject({ kind: "image" });
  });
  it("cancels an uncooperative decoder promptly and rejects the total preparation timeout", async () => {
    const document = doc(); image(document, () => new Promise(() => {}));
    const controller = new AbortController();
    const pending = preparePrintResources(document, {}, controller.signal); controller.abort(new DOMException("replaced", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    vi.useFakeTimers();
    const timeout = preparePrintResources(document, { resourceTimeoutMs: 20 });
    const assertion = expect(timeout).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(21); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("decodes at most four images concurrently and supports custom error messages", async () => {
    const document = doc(), first = deferred<void>();
    let active = 0, peak = 0;
    const decode = vi.fn(async () => { active++; peak = Math.max(peak, active); await first.promise; active--; });
    for (let i = 0; i < 9; i++) image(document, decode);
    const pending = preparePrintResources(document); await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(4));
    first.resolve(); await pending;
    expect(peak).toBe(4); expect(decode).toHaveBeenCalledTimes(9);
    expect(printResourceMessage(new ReportPrintResourceError("font", "Brand"), { printFontFailed: "Missing {family}" })).toBe("Missing Brand");
  });
  it("fails invalid options before fetching assets", async () => {
    for (const resourceTimeoutMs of [0, NaN, 120001]) await expect(preparePrintResources(doc(), { resourceTimeoutMs })).rejects.toMatchObject({ kind: "config" });
    await expect(preparePrintResources(doc(), { fonts: Array.from({ length: 9 }, () => ({ family: "A", source: "/font.ttf" })) })).rejects.toMatchObject({ kind: "config" });
  });
});
describe("print calibration", () => {
  it("keeps real page geometry and translates only print contents, leaving the original plan untouched", () => {
    const plan = createPrintCalibrationPlan(80, 55), original = JSON.stringify(plan);
    const normal = buildPrintDocument(plan), adjusted = buildPrintDocument(plan, { calibration: { offsetXmm: 1.2, offsetYmm: -.5 } });
    expect(adjusted.head).toContain("size:80mm 55mm");
    expect(adjusted.pageChunks[0]).toContain("translate(1.2mm,-0.5mm)");
    expect(normal.pageChunks[0]).not.toContain("translate("); expect(JSON.stringify(plan)).toBe(original);
    expect(plan.pages[0]!.components[0]).toMatchObject({ kind: "rect", widthMm: 35, heightMm: 35 });
    expect(() => printCalibration({ calibration: { offsetXmm: 21 } })).toThrow(/20/);
    expect(() => createPrintCalibrationPlan(5, 55)).toThrow(/25/);
  });
  it("does not invoke the system print function after preparation failed", async () => {
    const before = document.createElement.bind(document), print = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation(((name: string, options?: ElementCreationOptions) => {
      const element = before(name, options);
      if (name === "iframe") queueMicrotask(() => { Object.defineProperty((element as HTMLIFrameElement).contentWindow!, "print", { value: print }); });
      return element;
    }) as typeof document.createElement);
    const onError = vi.fn();
    await expect(printPlans([createPrintCalibrationPlan(80, 55)], { printOptions: { resourceTimeoutMs: 0 }, onError })).rejects.toMatchObject({ code: "print-resource", kind: "config" });
    expect(print).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledOnce(); expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });
  it("immediately removes a prepared iframe when the browser print call throws", async () => {
    const before = document.createElement.bind(document), failure = new Error("browser rejected print");
    vi.spyOn(document, "createElement").mockImplementation(((name: string, options?: ElementCreationOptions) => {
      const element = before(name, options);
      if (name === "iframe") queueMicrotask(() => {
        Object.defineProperty((element as HTMLIFrameElement).contentWindow!, "print", { value: () => { throw failure; } });
      });
      return element;
    }) as typeof document.createElement);
    await expect(printPlans([createPrintCalibrationPlan(80, 55)])).rejects.toBe(failure);
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });
  it("rejects the original failure without an observer and isolates throwing observers", async () => {
    for (const onError of [undefined, () => { throw new Error("observer failure"); }, async () => { throw new Error("async observer failure"); }]) {
      await expect(printPlans([createPrintCalibrationPlan(80, 55)], { printOptions: { resourceTimeoutMs: 0 }, onError })).rejects.toMatchObject({ code: "print-resource", kind: "config" });
      expect(document.querySelectorAll("iframe")).toHaveLength(0);
    }
  });
});
