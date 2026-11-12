import type { ReportEditingOptions } from "./editing";

type Persistence = Pick<ReportEditingOptions, "save" | "saveBatch">;
interface ProviderEditingFactory extends Persistence { create(): ReportEditingOptions }
type SaveCallback = NonNullable<Persistence["save"]> | NonNullable<Persistence["saveBatch"]>;
const factories = new WeakMap<SaveCallback, ProviderEditingFactory>();
const FACTORY = Symbol.for("mach-report/provider-editing-factory/v1");

function factoryFor(callback: SaveCallback | undefined): ProviderEditingFactory | undefined {
  if (!callback) return;
  const local = factories.get(callback);
  if (local) return local;
  // A federated host and preview may load separate SDK copies in the same realm.
  try {
    const value: unknown = Object.getOwnPropertyDescriptor(callback, FACTORY)?.value;
    if (!value || typeof value !== "object") return;
    const factory = value as ProviderEditingFactory;
    return typeof factory.create === "function" && (factory.save === callback || factory.saveBatch === callback) ? factory : undefined;
  } catch { return; }
}

/** Private ownership marker survives reactive proxies and shallow control overrides. */
export function registerProviderEditing(options: ReportEditingOptions, create: () => ReportEditingOptions): void {
  const factory = { save: options.save, saveBatch: options.saveBatch, create };
  for (const callback of [options.save, options.saveBatch]) if (callback) {
    factories.set(callback, factory);
    Object.defineProperty(callback, FACTORY, { value: factory });
  }
}

/** Each preview owns one persistence instance per factory. Weak keys retain no query history. */
export function createProviderEditingScope(): (options: ReportEditingOptions) => Persistence {
  const instances = new WeakMap<ProviderEditingFactory, ReportEditingOptions>();
  return (options) => {
    const factory = factoryFor(options.saveBatch) ?? factoryFor(options.save);
    if (!factory) return options;
    let instance = instances.get(factory);
    if (!instance) { instance = factory.create(); instances.set(factory, instance); }
    return {
      save: options.save === factory.save ? instance.save : options.save,
      saveBatch: options.saveBatch === factory.saveBatch ? instance.saveBatch : options.saveBatch
    };
  };
}
