import ts from "typescript";

const retiredVueImports = new Set(["PublicProps", "ComponentProvideOptions", "CreateComponentPublicInstanceWithMixins", "GlobalComponents", "GlobalDirectives", "ComponentOptionsBase"]);
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

/**
 * Publish the shared Vue 3.2+ component contract rather than compiler-version-specific
 * template refs. The first twelve DefineComponent parameters have the same meanings
 * in 3.2 and 3.5: props, exposed bindings, options, mixins, events and defaults.
 * Later parameters describe slots/local components/directives/provider/template refs.
 * Volar's separately inferred public slots are retained below; internal refs are not API.
 */
export function normalizeVueDeclaration(content, entry) {
  const source = ts.createSourceFile(entry, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let needsPublicProps = false;
  const replacements = ts.transform(source, [(context) => {
    function visit(node) {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === "vue") return normalizeImport(node);
      if (ts.isTypeReferenceNode(node)) {
        const name = ts.isIdentifier(node.typeName) ? node.typeName.text : "";
        if (name === "PublicProps") { needsPublicProps = true; return ts.factory.createTypeReferenceNode("MachReportVuePublicProps"); }
        if (name === "DefineComponent" && node.typeArguments?.length > 12) return ts.visitEachChild(ts.factory.updateTypeReferenceNode(node, node.typeName, node.typeArguments.slice(0, 12)), visit, context);
        if (name === "Ref" && node.typeArguments?.length === 2) return normalizeRef(node);
      }
      if (ts.isFunctionDeclaration(node) && node.name?.text === "__VLS_template") return normalizeTemplateSlots(node);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "MachReportPreview") {
        const type = entry.endsWith("/async.d.ts")
          ? ts.factory.createImportTypeNode(ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral("@agile-team/mach-report/vue")), undefined, ts.factory.createIdentifier("ReportPreview"), undefined, true)
          : ts.factory.createTypeQueryNode(ts.factory.createIdentifier("ReportPreview"));
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, type, node.initializer);
      }
      return ts.visitEachChild(node, visit, context);
    }
    function normalizeImport(node) {
      const bindings = node.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) return node;
      const kept = bindings.elements.filter((element) => !retiredVueImports.has((element.propertyName ?? element.name).text));
      if (!kept.length && !node.importClause.name) return undefined;
      const clause = ts.factory.updateImportClause(node.importClause, node.importClause.isTypeOnly, node.importClause.name, ts.factory.updateNamedImports(bindings, kept));
      return ts.factory.updateImportDeclaration(node, node.modifiers, clause, node.moduleSpecifier, node.attributes);
    }
    function normalizeRef(node) {
      const [read, write] = node.typeArguments;
      if (printer.printNode(ts.EmitHint.Unspecified, read, source) !== printer.printNode(ts.EmitHint.Unspecified, write, source)) throw new Error(`${entry}: Ref has different read/write types; an explicit compatible contract is required`);
      return ts.visitEachChild(ts.factory.updateTypeReferenceNode(node, node.typeName, [read]), visit, context);
    }
    function normalizeTemplateSlots(node) {
      if (!node.type || !ts.isTypeLiteralNode(node.type)) throw new Error(`${entry}: unexpected Volar template declaration`);
      const slots = node.type.members.find((member) => member.name && ts.isIdentifier(member.name) && member.name.text === "slots");
      if (!slots) throw new Error(`${entry}: missing public template slots`);
      return ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, ts.factory.createTypeLiteralNode([slots]), node.body);
    }
    return (node) => ts.visitNode(node, visit);
  }]);
  try {
    let output = printer.printFile(replacements.transformed[0]);
    if (needsPublicProps) output += '\n/** Stable public attrs shared by supported Vue versions. */\ntype MachReportVuePublicProps = import("vue").VNodeProps & import("vue").AllowedComponentProps & import("vue").ComponentCustomProps;\n';
    assertStableVueReferences(output, entry);
    return output;
  } finally { replacements.dispose(); }
}

function assertStableVueReferences(content, entry) {
  const source = ts.createSourceFile(entry, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && retiredVueImports.has(node.typeName.text)) throw new Error(`${entry}: Vue compiler internals escaped the public contract: ${node.typeName.text}`);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
