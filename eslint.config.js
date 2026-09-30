import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser }
    }
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "vue/multi-word-component-names": "off",
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/html-self-closing": "off",
      "vue/html-indent": "off",
      "vue/attributes-order": "off"
    }
  },
  {
    // 单包架构边界守护：引擎核心（主入口能力）不得反向依赖 pdf/sql/manager/vue
    // 子路径域——保证主入口产物永远不携带重依赖与框架代码（框架零耦合）。
    files: [
      "packages/mach-report/src/index.ts",
      "packages/mach-report/src/{defaults,units,pdf,sql,manager}.ts",
      "packages/mach-report/src/{layout,render,schema,builder,compat}/**/*.ts"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../pdf/*", "../pdf", "../sql/*", "../sql", "../manager/*", "../manager", "../vue/*", "../vue"], message: "Engine core must not depend on subpath domains (pdf/sql/manager/vue)." },
            { group: ["@agile-team/mach-report/pdf", "@agile-team/mach-report/sql", "@agile-team/mach-report/manager", "@agile-team/mach-report/vue"], message: "Engine core must not depend on subpath domains (pdf/sql/manager/vue)." }
          ]
        }
      ]
    }
  }
);
