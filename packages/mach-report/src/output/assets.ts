import type { GridCell, PlanComponent, RenderPlan } from "../schema/render-plan";
import type { OutputDiagnostic, OutputDiagnosticOptions, OutputFormat } from "./capabilities";

export type ImageComponentKind = "image" | "chart" | "barcode" | "qrcode";

export interface ComponentImageContext {
  readonly component: Readonly<PlanComponent>;
  readonly pageIndex: number;
  readonly componentIndex: number;
  readonly componentPath: readonly number[];
  readonly signal: AbortSignal;
}

export type ComponentImageRenderer = (context: ComponentImageContext) => string | Promise<string>;

export interface AssetRenderBudget {
  /** Maximum newly rendered assets, default 1000. Existing imageData is kept unchanged. */
  maxAssets?: number;
  /** Maximum image payload bytes per new asset, default 32 MiB. */
  maxImageBytes?: number;
  /** Maximum total image payload bytes for new assets, default 128 MiB. */
  maxTotalImageBytes?: number;
  /** Wall-clock budget, including adapters that ignore AbortSignal. Default 30 seconds. */
  maxDurationMs?: number;
}

export interface AssetRenderOptions extends OutputDiagnosticOptions {
  assetRenderers?: Partial<Record<ImageComponentKind, ComponentImageRenderer>>;
  assetBudget?: AssetRenderBudget;
  /** Default throw prevents an incomplete export; placeholder retains the component and emits diagnostics. */
  assetFailure?: "throw" | "placeholder";
  signal?: AbortSignal;
}

export interface ResolvePlanAssetsOptions extends AssetRenderOptions {
  /** Only labels diagnostics; no output library is imported. Default dom. */
  format?: OutputFormat;
  start?: number;
  end?: number;
}

export class OutputAssetError extends Error {
  readonly diagnostic: OutputDiagnostic;
  readonly cause: unknown;
  constructor(diagnostic: OutputDiagnostic, cause?: unknown) {
    super(diagnostic.message);
    this.name = "OutputAssetError";
    this.diagnostic = diagnostic;
    this.cause = cause;
  }
}

interface AssetState {
  options: ResolvePlanAssetsOptions;
  signal: AbortSignal;
  diagnostics: OutputDiagnostic[];
  rendered: number;
  bytes: number;
  budget: Required<AssetRenderBudget>;
  cache: WeakMap<PlanComponent, Promise<string | undefined>>;
  active?: Omit<ComponentImageContext, "signal">;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function withAbort<T>(pending: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(pending).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function assetBudget(options: ResolvePlanAssetsOptions): Required<AssetRenderBudget> {
  const result = { maxAssets: 1000, maxImageBytes: 32 * 1024 * 1024, maxTotalImageBytes: 128 * 1024 * 1024, maxDurationMs: 30_000, ...options.assetBudget };
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new RangeError(`${key} must be a positive safe integer at most 2147483647.`);
  }
  return result;
}

function imageBytes(data: string): number {
  const match = /^data:image\/[a-z0-9.+-]+(;base64)?,(.*)$/is.exec(data);
  if (!match) throw new TypeError("Asset renderers must return an image data URL.");
  if (match[1]) return Math.ceil(match[2]!.length * 3 / 4);
  return new TextEncoder().encode(decodeURIComponent(match[2]!)).byteLength;
}

function issue(state: AssetState, context: Omit<ComponentImageContext, "signal">, code: "asset-render-failed" | "asset-budget-exceeded", message: string, cause?: unknown): undefined {
  const diagnostic: OutputDiagnostic = { code, message, severity: "warning", format: state.options.format ?? "dom", pageIndex: context.pageIndex, componentIndex: context.componentIndex, componentPath: context.componentPath, kind: context.component.kind, nid: context.component.nid };
  state.diagnostics.push(diagnostic);
  state.options.onDiagnostic?.(diagnostic);
  if (state.options.assetFailure !== "placeholder") throw new OutputAssetError(diagnostic, cause);
  return undefined;
}

async function renderImage(state: AssetState, component: PlanComponent, context: Omit<ComponentImageContext, "signal">): Promise<string | undefined> {
  const renderer = state.options.assetRenderers?.[component.kind as ImageComponentKind];
  if (component.imageData || !renderer) return component.imageData;
  if (++state.rendered > state.budget.maxAssets) return issue(state, context, "asset-budget-exceeded", "Output exceeded the asset count budget.");
  let image: string;
  try {
    state.active = context;
    image = await withAbort(renderer({ ...context, signal: state.signal }), state.signal);
    throwIfAborted(state.signal);
    if (image.length > state.budget.maxImageBytes * 4 + 1024) return issue(state, context, "asset-budget-exceeded", "Output exceeded the image payload byte budget.");
    const bytes = imageBytes(image);
    if (bytes > state.budget.maxImageBytes || state.bytes + bytes > state.budget.maxTotalImageBytes) return issue(state, context, "asset-budget-exceeded", "Output exceeded the encoded image byte budget.");
    state.bytes += bytes;
  } catch (error) {
    if (state.signal.aborted || error instanceof OutputAssetError) throw error;
    return issue(state, context, "asset-render-failed", `Asset renderer failed for ${component.kind}; output was not silently omitted.`, error);
  }
  return image;
}

function timeoutAssets(state: AssetState, controller: AbortController): void {
  const context = state.active;
  if (!context) { controller.abort(new Error("Asset rendering exceeded maxDurationMs.")); return; }
  const diagnostic: OutputDiagnostic = { code: "asset-budget-exceeded", message: "Asset rendering exceeded maxDurationMs.", severity: "warning", format: state.options.format ?? "dom", pageIndex: context.pageIndex, componentIndex: context.componentIndex, componentPath: context.componentPath, kind: context.component.kind, nid: context.component.nid };
  state.diagnostics.push(diagnostic);
  try { state.options.onDiagnostic?.(diagnostic); }
  catch (error) { controller.abort(error); return; }
  controller.abort(new OutputAssetError(diagnostic));
}

async function resolveCell(state: AssetState, cell: GridCell | null, context: Omit<ComponentImageContext, "signal">, path: readonly number[], ancestors: ReadonlySet<PlanComponent>): Promise<GridCell | null> {
  if (!cell?.children?.length) return cell;
  const children: PlanComponent[] = [];
  for (const [index, component] of cell.children.entries()) {
    children.push(await resolveComponent(state, component, { ...context, component, componentPath: [...path, index] }, ancestors));
  }
  return children.some((component, index) => component !== cell.children![index]) ? { ...cell, children } : cell;
}

async function resolveComponent(state: AssetState, component: PlanComponent, context: Omit<ComponentImageContext, "signal">, ancestors: ReadonlySet<PlanComponent>): Promise<PlanComponent> {
  throwIfAborted(state.signal);
  if (ancestors.has(component)) throw new TypeError("Cyclic grid children cannot be rendered.");
  let pending = state.cache.get(component);
  if (!pending) { pending = renderImage(state, component, context); state.cache.set(component, pending); }
  const imageData = await pending;
  let grid = component.grid;
  if (grid) {
    const visited = new Set(ancestors).add(component);
    const cells: (GridCell | null)[][] = [];
    for (const [rowIndex, row] of grid.cells.entries()) {
      const next: (GridCell | null)[] = [];
      for (const [columnIndex, cell] of row.entries()) next.push(await resolveCell(state, cell, context, [...context.componentPath, rowIndex, columnIndex], visited));
      cells.push(next);
    }
    if (cells.some((row, ri) => row.some((cell, ci) => cell !== grid!.cells[ri]![ci]))) grid = { ...grid, cells };
  }
  return imageData !== component.imageData || grid !== component.grid ? { ...component, imageData, grid } : component;
}

/** Resolve optional third-party chart/barcode/QR adapters once, before any output backend. Input stays immutable. */
export async function resolvePlanAssets(plan: RenderPlan, options: ResolvePlanAssetsOptions = {}): Promise<{ plan: RenderPlan; diagnostics: OutputDiagnostic[] }> {
  const budget = assetBudget(options);
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (!options.assetRenderers || !Object.keys(options.assetRenderers).length) { options.signal?.removeEventListener("abort", abort); return { plan, diagnostics: [] }; }
  const state: AssetState = { options, signal: controller.signal, diagnostics: [], rendered: 0, bytes: 0, budget, cache: new WeakMap() };
  const timer = setTimeout(() => timeoutAssets(state, controller), budget.maxDurationMs);
  try {
    const pages = [];
    for (const [pageIndex, page] of plan.pages.entries()) {
      if (pageIndex < (options.start ?? 0) || pageIndex > (options.end ?? plan.pages.length - 1)) { pages.push(page); continue; }
      const components: PlanComponent[] = [];
      for (const [componentIndex, component] of page.components.entries()) components.push(await resolveComponent(state, component, { component, pageIndex, componentIndex, componentPath: [] }, new Set()));
      pages.push(components.some((component, index) => component !== page.components[index]) ? { ...page, components } : page);
    }
    return { plan: pages.some((page, index) => page !== plan.pages[index]) ? { ...plan, pages } : plan, diagnostics: state.diagnostics };
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
