/** Report DTOs contain JSON data; JSON cloning also accepts Vue reactive proxies. */
export function cloneReportSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
