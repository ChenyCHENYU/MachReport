// @vitest-environment node
import { bench, describe } from "vitest";
import { createLabelTemplate } from "../builder/label-template";
import { paginateTemplate } from "../layout/paginate";
import type { PlanComponent } from "../schema/render-plan";

const components: PlanComponent[] = Array.from({ length: 8 }, (_, index) => ({
  kind: "text", leftMm: 2, topMm: 2 + index * 4, widthMm: 76, heightMm: 4,
  text: `物料标签 ${index + 1} MATERIAL IDENTIFICATION`, style: { fontSize: 5 }
}));
components.push({ kind: "text", leftMm: 2, topMm: 36, widthMm: 76, heightMm: 4, binding: { field: "grade" }, style: { fontSize: 5 } });
components.push({ kind: "text", leftMm: 2, topMm: 40, widthMm: 76, heightMm: 4, binding: { field: "serial" }, style: { fontSize: 5 } });
const template = createLabelTemplate({ dataset: "labels", rowKey: "serial", components });
const labels = Array.from({ length: 1000 }, (_, index) => ({ serial: `MR-${String(index).padStart(8, "0")}`, grade: index % 2 ? "S304H3" : "S316LS" }));

describe("bounded industrial label layout", () => {
  bench("1,000 records: eight static texts, two repeated grades, unique serials", () => {
    paginateTemplate(template, { labels });
  });
  bench("1,000 copies: reuse one record without repeating text measurement", () => {
    paginateTemplate({ ...template, repeat: { ...template.repeat!, copies: 1000 } }, { labels: [labels[0]!] });
  });
});
