// @vitest-environment node
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { normalizeVueDeclaration } from "../../../../scripts/normalize-vue-declarations.mjs";

describe("public Vue declaration compatibility projection", () => {
  it("retains props, controller bindings, emits, defaults and slots while omitting private template refs", () => {
    const source = `import { DefineComponent, PublicProps, ComponentProvideOptions, CreateComponentPublicInstanceWithMixins, Ref } from 'vue';
declare const __VLS_component: DefineComponent<{ reportId: string }, { reload(): Promise<void> }, {}, {}, {}, Mixin, Mixin, { loaded(count: number): void }, string, PublicProps, { reportId: string }, { reportId: string }, {}, {}, {}, string, ComponentProvideOptions, true, { privateRef: CreateComponentPublicInstanceWithMixins<{}> }>;
declare function __VLS_template(): { slots: { settings?(props: {}): unknown }; refs: { privateRef: CreateComponentPublicInstanceWithMixins<{}> }; rootEl: HTMLDivElement };
export declare const ReportPreview: typeof __VLS_component;
export declare const MachReportPreview: { new(): CreateComponentPublicInstanceWithMixins<{}> };
export declare function zoom(): Ref<number, number>;`;
    const output = normalizeVueDeclaration(source, "dist/vue/index.d.ts");
    const parsed = ts.createSourceFile("test.d.ts", output, ts.ScriptTarget.Latest, true);
    let genericArguments = 0;
    function visit(node: ts.Node) { if (ts.isTypeReferenceNode(node) && node.typeName.getText(parsed) === "DefineComponent") genericArguments = node.typeArguments!.length; ts.forEachChild(node, visit); }
    visit(parsed); expect(genericArguments).toBe(12);
    for (const expected of ["reportId: string", "reload(): Promise<void>", "loaded(count: number): void", "settings?", "MachReportPreview: typeof ReportPreview", "Ref<number>", "VNodeProps"]) expect(output).toContain(expected);
    for (const removed of ["privateRef", "rootEl", "ComponentProvideOptions", "CreateComponentPublicInstanceWithMixins"]) expect(output).not.toContain(removed);
  });
  it("shares the exact static component type for the asynchronous entry", () => {
    const output = normalizeVueDeclaration('export declare const MachReportPreview: { private: unknown };', "dist/vue/async.d.ts");
    expect(output).toContain('typeof import("@agile-team/mach-report/vue").ReportPreview');
  });
  it.each(["dist/vue/index.d.ts", "dist/vue/async.d.ts"])("removes orphaned compiler imports after projecting private Volar refs in %s", (entry) => {
    const source = `import { DefineComponent } from 'vue';
import { OnCleanup } from '@vue/reactivity';
declare const __VLS_component: DefineComponent<{}, {}, {}, {}, {}, {}, {}, {}, string, {}, {}, {}, {}, {}, {}, string, {}, true, { cleanup: OnCleanup }>;
declare function __VLS_template(): { slots: { settings?(): unknown }; refs: { cleanup: OnCleanup } };
export declare const ReportPreview: typeof __VLS_component;`;
    const output = normalizeVueDeclaration(source, entry);
    expect(output).not.toContain("OnCleanup");
    expect(output).not.toContain("@vue/reactivity");
    expect(output).toContain("DefineComponent");
    expect(output).toContain("settings?");
    expect(output).toContain("ReportPreview");
  });
  it("retains real references, imported aliases and local re-exports while distinguishing shadowed names", () => {
    const source = `import { Used, Aliased as Local, Reexported, Shadowed, PropertyOnly, NotReexported } from 'public-contract';
import { NotReexported as External } from 'another-contract';
export interface Public extends Used { value: Local; method<Shadowed>(input: Shadowed): Shadowed; PropertyOnly: string; }
export { Reexported as Exported };
export type { External };
export { NotReexported } from 'third-contract';`;
    const output = normalizeVueDeclaration(source, "dist/vue/index.d.ts");
    const parsed = ts.createSourceFile("test.d.ts", output, ts.ScriptTarget.Latest, true);
    const first = parsed.statements.find(ts.isImportDeclaration)!;
    const bindings = first.importClause!.namedBindings as ts.NamedImports;
    expect(bindings.elements.map((element) => element.name.text)).toEqual(["Used", "Local", "Reexported"]);
    expect(output).toContain("NotReexported as External");
    expect(output).toContain("Reexported as Exported");
    expect(output).toContain("export type { External }");
    expect(output).toContain("method<Shadowed>");
    expect(output).toContain("PropertyOnly: string");
  });
  it("never strips an internal-module import still referenced by the public signature", () => {
    const source = `import { OnCleanup as Cleanup, effect } from '@vue/reactivity';
export declare function observe(cleanup: Cleanup): typeof effect;`;
    const output = normalizeVueDeclaration(source, "dist/vue/index.d.ts");
    expect(output).toContain("OnCleanup as Cleanup, effect");
    expect(output).toContain("@vue/reactivity");
    expect(output).toContain("cleanup: Cleanup");
    expect(output).toContain("typeof effect");
  });
  it("preserves explicit side effects, default and namespace bindings when only named bindings disappear", () => {
    const source = `import 'register-global-contracts';
import {} from 'explicit-side-effect';
import {} from 'vue';
import Default, { Orphan } from 'mixed-contract';
import DefaultOnly from 'default-contract';
import * as Namespace from 'namespace-contract';
import type { UsedType, UnusedType } from 'type-contract';
export declare const value: UsedType;`;
    const output = normalizeVueDeclaration(source, "dist/vue/index.d.ts");
    const parsed = ts.createSourceFile("test.d.ts", output, ts.ScriptTarget.Latest, true);
    const imports = parsed.statements.filter(ts.isImportDeclaration);
    expect(imports.map((statement) => ({
      module: (statement.moduleSpecifier as ts.StringLiteral).text,
      default: statement.importClause?.name?.text,
      bindings: statement.importClause?.namedBindings?.getText(parsed),
      typeOnly: statement.importClause?.isTypeOnly ?? false
    }))).toEqual([
      { module: "register-global-contracts", default: undefined, bindings: undefined, typeOnly: false },
      { module: "explicit-side-effect", default: undefined, bindings: "{}", typeOnly: false },
      { module: "vue", default: undefined, bindings: "{}", typeOnly: false },
      { module: "mixed-contract", default: "Default", bindings: undefined, typeOnly: false },
      { module: "default-contract", default: "DefaultOnly", bindings: undefined, typeOnly: false },
      { module: "namespace-contract", default: undefined, bindings: "* as Namespace", typeOnly: false },
      { module: "type-contract", default: undefined, bindings: "{ UsedType }", typeOnly: true }
    ]);
    expect(output).not.toContain("Orphan");
    expect(output).not.toContain("UnusedType");
  });
  it("fails explicitly on unsupported future compiler shapes rather than erasing type differences", () => {
    expect(() => normalizeVueDeclaration('import { Ref } from "vue"; export declare const value: Ref<number, string>;', "vue.d.ts")).toThrow("different read/write types");
    expect(() => normalizeVueDeclaration('declare function __VLS_template(): unknown;', "vue.d.ts")).toThrow("unexpected Volar");
    expect(() => normalizeVueDeclaration('declare function __VLS_template(): { refs: {} };', "vue.d.ts")).toThrow("missing public template slots");
    expect(() => normalizeVueDeclaration('import { GlobalComponents } from "vue"; export type Public = GlobalComponents;', "vue.d.ts")).toThrow("compiler internals escaped");
  });
});
