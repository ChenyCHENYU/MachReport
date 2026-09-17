declare module "virtual:__federation__" {
  export function __federation_method_setRemote(name: string, config: Record<string, unknown>): void;
  export function __federation_method_getRemote(name: string, expose: string): Promise<unknown>;
  export function __federation_method_preloadRemote(name: string): Promise<void>;
  export function __federation_method_ensure(name: string): Promise<void>;
}
