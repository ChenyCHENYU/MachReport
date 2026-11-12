import type { DatasetRows, ReportTemplate } from "../layout/paginate";
type Inspector = (reportId: string, data: DatasetRows, template: ReportTemplate) => void;
const inspectors = new WeakMap<object, Inspector>();
/** Internal bridge; public source options and raw onDatasets timing stay intact. */
export function inspectOwnedSource<T extends object>(options: T, inspect: Inspector): T {
  inspectors.set(options, inspect);
  return options;
}
export function notifyOwnedSource(options: object, reportId: string, data: DatasetRows, template: ReportTemplate): void {
  inspectors.get(options)?.(reportId, data, template);
}
