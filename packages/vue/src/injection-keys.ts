import type { InjectionKey } from "vue";
import type { PlanFetcher } from "./adapters";

export const MACH_REPORT_FETCHER_KEY: InjectionKey<PlanFetcher> = Symbol("mach-report-fetcher");
