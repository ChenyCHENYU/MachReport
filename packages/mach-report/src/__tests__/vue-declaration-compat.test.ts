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
  it("fails explicitly on unsupported future compiler shapes rather than erasing type differences", () => {
    expect(() => normalizeVueDeclaration('import { Ref } from "vue"; export declare const value: Ref<number, string>;', "vue.d.ts")).toThrow("different read/write types");
    expect(() => normalizeVueDeclaration('declare function __VLS_template(): unknown;', "vue.d.ts")).toThrow("unexpected Volar");
    expect(() => normalizeVueDeclaration('declare function __VLS_template(): { refs: {} };', "vue.d.ts")).toThrow("missing public template slots");
    expect(() => normalizeVueDeclaration('import { GlobalComponents } from "vue"; export type Public = GlobalComponents;', "vue.d.ts")).toThrow("compiler internals escaped");
  });
});
