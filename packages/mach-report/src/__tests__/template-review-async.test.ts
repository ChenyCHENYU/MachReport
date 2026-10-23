// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createTableTemplate, defineReportTemplate } from "../index";
import {
  reviewReportTemplate,
  reviewReportTemplateAsync,
  type ReportTemplateReviewProgress,
} from "../source/template-review";
const document = () =>
  defineReportTemplate({
    id: "async-review",
    name: "Async",
    template: createTableTemplate({
      columns: [
        { field: "id", header: "ID", widthMm: 35 },
        { field: "qty", header: "Qty", widthMm: 35 },
      ],
    }),
  });
const fixtures = [
  { name: "zero", datasets: { detail: [{ id: "00001", qty: 0 }] } },
  { name: "empty", datasets: { detail: [] } },
  { name: "values", datasets: { detail: [{ id: "00002", qty: 12 }] } },
];

describe("cooperative template review", () => {
  it("produces identical checks to the synchronous API while yielding and reporting each scenario", async () => {
    const current = document(),
      previous = document(),
      progress: ReportTemplateReviewProgress[] = [];
    current.name = "Changed";
    const options = {
      previous,
      fixtures,
      formats: ["pdf" as const],
      dataSchemas: {
        detail: {
          fields: [
            { field: "id", type: "text" as const },
            { field: "qty", type: "number" as const },
          ],
        },
      },
    };
    let turns = 0;
    const heartbeat = setInterval(() => {
      turns++;
    }, 0);
    try {
      const result = await reviewReportTemplateAsync(current, {
        ...options,
        onProgress: (value) => progress.push(value),
      });
      expect(result).toEqual(reviewReportTemplate(current, options));
      expect(progress.map((value) => value.stage)).toEqual([
        "template",
        "baseline",
        "bindings",
        "fixture",
        "fixture",
        "fixture",
      ]);
      expect(
        progress
          .filter((value) => value.fixture)
          .map((value) => [value.completed, value.total, value.fixture]),
      ).toEqual([
        [1, 3, "zero"],
        [2, 3, "empty"],
        [3, 3, "values"],
      ]);
      expect(turns).toBeGreaterThanOrEqual(3);
    } finally {
      clearInterval(heartbeat);
    }
  });
  it("rejects pre-cancelled work before parsing and clears a later scheduled timer", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController(),
        getter = vi.fn();
      const input = Object.defineProperty({}, "id", {
        get: getter,
        enumerable: true,
      });
      controller.abort(new Error("cancelled before template"));
      const pending = reviewReportTemplateAsync(input, {
        signal: controller.signal,
      });
      await expect(pending).rejects.toThrow("cancelled before template");
      expect(getter).not.toHaveBeenCalled();
      const next = new AbortController();
      const later = reviewReportTemplateAsync(document(), {
        fixtures,
        signal: next.signal,
      });
      next.abort(new Error("cancelled while yielding"));
      await expect(later).rejects.toThrow("cancelled while yielding");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("captures the primary template before its first yield and isolates progress observers", async () => {
    const input = document(),
      expected = reviewReportTemplate(input, { fixtures });
    const pending = reviewReportTemplateAsync(input, {
      fixtures,
      onProgress: () => {
        throw new Error("observer failure");
      },
    });
    (
      input.template.pages[0]!.components[0] as {
        columns: Array<{ field: string }>;
      }
    ).columns[0]!.field = "changed_after_start";
    expect(await pending).toEqual(expected);
  });
  it("cancels before inspecting a baseline or its bindings", async () => {
    const controller = new AbortController(),
      progress: string[] = [],
      getter = vi.fn();
    const previous = Object.defineProperty({}, "id", {
      enumerable: true,
      get: getter,
    });
    await expect(
      reviewReportTemplateAsync(document(), {
        previous: previous as ReturnType<typeof document>,
        signal: controller.signal,
        onProgress: (value) => {
          progress.push(value.stage);
          if (value.stage === "template")
            controller.abort(new Error("before baseline"));
        },
      }),
    ).rejects.toThrow("before baseline");
    expect(progress).toEqual(["template"]);
    expect(getter).not.toHaveBeenCalled();
  });
  it("stops between scenarios without reading the next dataset or publishing a partial green result", async () => {
    const controller = new AbortController(),
      getter = vi.fn(() => []),
      completed: number[] = [];
    const datasets = Object.defineProperty({}, "detail", {
      enumerable: true,
      get: getter,
    });
    await expect(
      reviewReportTemplateAsync(document(), {
        fixtures: [fixtures[0]!, { name: "must-not-run", datasets }],
        signal: controller.signal,
        onProgress: (value) => {
          if (value.stage === "fixture") {
            completed.push(value.completed);
            controller.abort(new Error("after first scenario"));
          }
        },
      }),
    ).rejects.toThrow("after first scenario");
    expect(completed).toEqual([1]);
    expect(getter).not.toHaveBeenCalled();
  });
  it("retains structured validation issues and rejects invalid fixture names consistently", async () => {
    for (const options of [
      { fixtures: [fixtures[0]!, fixtures[0]!] },
      { fixtures: [{ name: "", datasets: {} }] },
      { maxPages: 0 },
    ]) {
      expect(await reviewReportTemplateAsync(document(), options)).toEqual(
        reviewReportTemplate(document(), options),
      );
    }
    const controller = new AbortController();
    controller.abort();
    await expect(
      reviewReportTemplateAsync(document(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
