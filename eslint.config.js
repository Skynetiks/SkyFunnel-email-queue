import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Configuration for src files with type-aware linting
  {
    files: ["src/**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: "error", // Enforce strict equality
      "no-var": "warn", // Disallow using var
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }], // Disallow unused variables
      "@typescript-eslint/no-floating-promises": "error", // Require promises to be awaited or handled
      "@typescript-eslint/no-misused-promises": "error", // Prevent common mistakes with promises
      "@typescript-eslint/require-await": "warn", // Warn if async function doesn't use await
    },
  },

  // Configuration for root-level script files without type-aware linting
  {
    files: ["*.ts", "*.js"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      eqeqeq: "error",
      "no-var": "warn",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },

  {
    ignores: ["node_modules/**/*", "dist/**/*", "*.config.js"], // Ignore node_modules, dist, and config files
  },

  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
];
