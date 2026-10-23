import {
  paginateTemplate,
  type ReportTemplateDocument,
  type ReportTemplateFixture,
} from "@agile-team/mach-report";
import { collectTemplateDatasetBindings } from "../source/template-bindings";
import type { PlanFetcher } from "@agile-team/mach-report/vue";
export interface ReviewComparison {
  current: {
    pages: number;
    dimensions: string[];
    fields: string[];
    fetcher: PlanFetcher;
  };
  previous?: ReviewComparison["current"];
  addedFields: string[];
  removedFields: string[];
}
function prepare(
  document: ReportTemplateDocument,
  fixture: ReportTemplateFixture,
): ReviewComparison["current"] {
  const result = paginateTemplate(document.template, fixture.datasets, {
    maxPages: 100,
    maxCells: 250000,
  });
  const fields = [
    ...new Set(
      collectTemplateDatasetBindings(document.template).flatMap((binding) =>
        binding.fields.map((item) => `${binding.dataset}.${item.field}`),
      ),
    ),
  ];
  return {
    pages: result.plan.pages.length,
    dimensions: [
      ...new Set(
        result.plan.pages.map(
          (page) => `${page.pageWidthMm} × ${page.pageHeightMm} mm`,
        ),
      ),
    ],
    fields,
    fetcher: async () => result.plan,
  };
}
/** One bounded layout per side; both previews reuse these exact plans rather than paginating again. */
export function compareTemplateFixture(
  document: ReportTemplateDocument,
  fixture: ReportTemplateFixture,
  previous?: ReportTemplateDocument,
): ReviewComparison {
  const current = prepare(document, fixture),
    baseline = previous ? prepare(previous, fixture) : undefined;
  const before = new Set(baseline?.fields),
    after = new Set(current.fields);
  return {
    current,
    previous: baseline,
    addedFields: current.fields.filter((field) => !before.has(field)),
    removedFields: baseline?.fields.filter((field) => !after.has(field)) ?? [],
  };
}
