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
    // 生产函数统一预算，测试夹具不参与；新增分支不能绕过包内质量门禁。
    files: ["packages/mach-report/src/**/*.{ts,vue}"],
    ignores: ["**/__tests__/**", "**/*.bench.ts"],
    rules: { complexity: ["error", { max: 20 }] }
  },
  {
    // 单包架构边界守护：引擎核心（主入口能力）不得反向依赖 pdf/sql/vue
    // 子路径域——保证主入口产物永远不携带重依赖与框架代码（框架零耦合）。
    files: [
      "packages/mach-report/src/index.ts",
      "packages/mach-report/src/{defaults,units,format}.ts",
      "packages/mach-report/src/{layout,render,schema,builder,source,editing,output,analytics}/**/*.ts"
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../pdf/*", "../pdf", "../sql/*", "../sql", "../xlsx/*", "../xlsx", "../vue/*", "../vue", "./pdf/*", "./sql/*", "./xlsx/*", "./vue/*", "../designer/*", "./designer/*"], message: "Engine core must not depend on optional output/framework domains." },
            { group: ["@agile-team/mach-report/pdf", "@agile-team/mach-report/sql", "@agile-team/mach-report/xlsx", "@agile-team/mach-report/xlsx/*", "@agile-team/mach-report/vue", "@agile-team/mach-report/vue/*", "@agile-team/mach-report/designer", "node:*", "vue", "exceljs", "pdf-lib", "node-sql-parser"], message: "Engine core must remain browser-safe and framework-independent." }
          ]
        }
      ]
    }
  }
);
