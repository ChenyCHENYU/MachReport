import type { InjectionKey } from "vue";
import type { PlanFetcher } from "./adapters";

/**
 * 字符串 key（而非裸 Symbol）：跨模块联邦边界时宿主与远程各自打包会生成
 * 不同的 Symbol 实例导致 inject 失效；字符串在两个 bundle 中恒等。
 * 保留 InjectionKey 类型以获得类型提示。
 */
export const MACH_REPORT_FETCHER_KEY = "mach-report/fetcher" as unknown as InjectionKey<PlanFetcher>;
