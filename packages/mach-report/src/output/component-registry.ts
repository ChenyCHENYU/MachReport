import type { PlanComponent } from "../schema/render-plan";
import { waitForOutput } from "./progress";
import type { AssetRenderOptions, ComponentAssetRegistry, ComponentImageContext, ComponentImageRenderer, ImageComponentKind } from "./assets";
import {
  checkExtensionIdentity, extensionJson, extensionKeys, extensionMetadata, extensionProps, extensionRecord, ReportComponentExtensionError,
  type ReportComponentExtensionBinding, type ReportComponentExtensionDefinition, type ReportComponentExtensionMetadata,
  type ReportComponentExtensionRenderer, type ReportComponentJson, type ReportComponentValue,
} from "./component-extension-model";

export type { ReportComponentValue, ReportComponentJson, ReportComponentProperty, ReportComponentExtensionBinding, ReportComponentExtensionMetadata, ReportComponentExtensionContext, ReportComponentExtensionRenderer, ReportComponentExtensionDefinition } from "./component-extension-model";
export { ReportComponentExtensionError } from "./component-extension-model";

export interface ReportComponentRegistry extends ComponentAssetRegistry {
  /** Pass directly as Preview/Runtime assets; no component-specific adapter wiring is needed. */
  readonly assets: Readonly<Pick<AssetRenderOptions, "assetRegistry">>;
  describe(kind?: ImageComponentKind): readonly Readonly<ReportComponentExtensionMetadata>[];
  /** Add native geometry and insert into the existing template/canvas command path. */
  createComponent(id: string, values?: { props?: Readonly<Record<string, ReportComponentValue>>; binding?: ReportComponentJson }): Pick<PlanComponent, "kind" | "meta">;
  /** Idempotent. Abort active consumers, release loaded renderers, and release a late loader when it finishes. */
  dispose(): Promise<void>;
}
interface Entry {
  metadata: Readonly<ReportComponentExtensionMetadata>;
  load: ReportComponentExtensionDefinition["load"];
  pending?: Promise<ReportComponentExtensionRenderer>;
  renderer?: ReportComponentExtensionRenderer;
  released?: Promise<void>;
}
const BINDING_KEY = "componentExtension";

function bindingOf(component: Readonly<PlanComponent>): unknown {
  const meta = Object.getOwnPropertyDescriptor(component, "meta")?.value as object | undefined;
  const descriptor = meta && Object.getOwnPropertyDescriptor(meta, BINDING_KEY);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set) throw new ReportComponentExtensionError("binding", "Component extension binding cannot be an accessor.", `$.meta.${BINDING_KEY}`);
  return descriptor.value;
}
function entryBinding(entries: ReadonlyMap<string, Entry>, component: Readonly<PlanComponent>): { entry: Entry; extension: Readonly<ReportComponentExtensionBinding> } {
  const value = extensionRecord(extensionJson(bindingOf(component)), `$.meta.${BINDING_KEY}`);
  extensionKeys(value, ["id", "version", "props", "binding"], `$.meta.${BINDING_KEY}`);
  checkExtensionIdentity(value.id, value.version);
  const entry = entries.get(value.id as string);
  if (!entry) throw new ReportComponentExtensionError("binding", "Component extension is not registered in this runtime.", `$.meta.${BINDING_KEY}.id`, value.id as string);
  if (entry.metadata.version !== value.version || entry.metadata.kind !== component.kind) throw new ReportComponentExtensionError("binding", "Component extension version or image kind does not match its registration.", `$.meta.${BINDING_KEY}`, entry.metadata.id);
  const extension = Object.freeze({ id: entry.metadata.id, version: entry.metadata.version, props: extensionProps(entry.metadata, value.props), ...(value.binding === undefined ? {} : { binding: value.binding as ReportComponentJson }) });
  return { entry, extension };
}
function release(entry: Entry): Promise<void> {
  return entry.released ??= Promise.resolve().then(() => entry.renderer?.dispose?.());
}
function assertOpen(disposed: boolean): void {
  if (disposed) throw new ReportComponentExtensionError("disposed", "Component registry has been disposed.");
}
function registryEntry(input: ReportComponentExtensionDefinition): Entry {
  if (!input || typeof input !== "object") throw new ReportComponentExtensionError("definition", "Component extension definition must be an object.");
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw new ReportComponentExtensionError("definition", "Component extension definition must be a plain object.");
  const loader = Object.getOwnPropertyDescriptor(input, "load");
  if (!loader || loader.get || loader.set || typeof loader.value !== "function") throw new ReportComponentExtensionError("definition", "Component extension needs a trusted runtime loader.", "$.load");
  return { metadata: extensionMetadata(input), load: loader.value as ReportComponentExtensionDefinition["load"] };
}
function checkRenderer(renderer: ReportComponentExtensionRenderer, id: string): void {
  if (renderer && typeof renderer.render === "function" && (renderer.dispose === undefined || typeof renderer.dispose === "function")) return;
  // Release an invalid module once without allowing cleanup failure or a never-ending cleanup to hide the contract error.
  if (renderer && typeof renderer.dispose === "function") {
    try { void Promise.resolve(renderer.dispose()).catch(() => undefined); }
    catch { /* The loader contract error remains the primary failure. */ }
  }
  throw new ReportComponentExtensionError("load", "Component loader must return render and optional dispose methods.", "$.load", id);
}
function consumerSignal(source: AbortSignal, lifetime: AbortSignal): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController(), abortSource = () => controller.abort(source.reason), abortLifetime = () => controller.abort(lifetime.reason);
  if (source.aborted) abortSource(); else source.addEventListener("abort", abortSource, { once: true });
  if (lifetime.aborted) abortLifetime(); else lifetime.addEventListener("abort", abortLifetime, { once: true });
  return { signal: controller.signal, dispose() { source.removeEventListener("abort", abortSource); lifetime.removeEventListener("abort", abortLifetime); } };
}

/** Explicit per-host registry. Templates contain bounded JSON bindings; loaders never come from a template. */
export function createReportComponentRegistry(definitions: readonly ReportComponentExtensionDefinition[]): ReportComponentRegistry {
  if (!Array.isArray(definitions) || definitions.length > 128) throw new ReportComponentExtensionError("definition", "Register at most 128 component extensions.");
  const entries = new Map<string, Entry>(), lifetime = new AbortController();
  let disposed = false, disposal: Promise<void> | undefined;
  for (const definition of definitions) {
    const entry = registryEntry(definition), id = entry.metadata.id;
    if (entries.has(id)) throw new ReportComponentExtensionError("definition", "Component extension id is already registered.", "$.id", id);
    entries.set(id, entry);
  }
  function load(entry: Entry): Promise<ReportComponentExtensionRenderer> {
    assertOpen(disposed);
    if (entry.pending) return entry.pending;
    entry.pending = Promise.resolve().then(() => { assertOpen(disposed); return entry.load(lifetime.signal); }).then(async renderer => {
      checkRenderer(renderer, entry.metadata.id);
      entry.renderer = renderer;
      if (disposed) { await release(entry); assertOpen(disposed); }
      return renderer;
    }).catch((cause: unknown) => {
      entry.pending = undefined;
      if (cause instanceof ReportComponentExtensionError) throw cause;
      throw Object.assign(new ReportComponentExtensionError("load", "Component extension loader failed.", "$.load", entry.metadata.id), { cause });
    });
    return entry.pending;
  }
  const render: ComponentImageRenderer = async (context: ComponentImageContext) => {
    assertOpen(disposed);
    const { entry, extension } = entryBinding(entries, context.component), consumer = consumerSignal(context.signal, lifetime.signal);
    try {
      const renderer = await waitForOutput(load(entry), consumer.signal);
      return await waitForOutput(renderer.render({ ...context, signal: consumer.signal, extension }), consumer.signal);
    } finally { consumer.dispose(); }
  };
  const registry: ReportComponentRegistry = {
    assets: Object.freeze({ get assetRegistry() { return registry; } }),
    describe(kind) { assertOpen(disposed); return Object.freeze([...entries.values()].map(entry => entry.metadata).filter(metadata => !kind || metadata.kind === kind)); },
    hasExtension(id, version, kind) { const metadata = entries.get(id)?.metadata; return !disposed && metadata?.version === version && metadata.kind === kind; },
    rendererFor(component) {
      const meta = Object.getOwnPropertyDescriptor(component, "meta")?.value as object | undefined;
      return meta && Object.prototype.hasOwnProperty.call(meta, BINDING_KEY) ? render : undefined;
    },
    createComponent(id, values = {}) {
      assertOpen(disposed);
      const entry = entries.get(id);
      if (!entry) throw new ReportComponentExtensionError("binding", "Component extension is not registered in this runtime.", "$.id", id);
      const data = extensionRecord(extensionJson(values), "$");
      extensionKeys(data, ["props", "binding"], "$");
      const extension: ReportComponentExtensionBinding = { id, version: entry.metadata.version, props: extensionProps(entry.metadata, data.props), ...(data.binding === undefined ? {} : { binding: data.binding as ReportComponentJson }) };
      return { kind: entry.metadata.kind, meta: { [BINDING_KEY]: Object.freeze(extension) } };
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true; lifetime.abort(new ReportComponentExtensionError("disposed", "Component registry has been disposed."));
      disposal = Promise.allSettled([...entries.values()].filter(entry => entry.renderer).map(release)).then(results => {
        const failed = results.find(result => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      });
      return disposal;
    },
  };
  return registry;
}
