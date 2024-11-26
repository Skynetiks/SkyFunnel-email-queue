import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  { files: ["src/**/*.{js,mjs,cjs,ts}"] },
  {
    languageOptions: { globals: globals.browser },
    rules: {
      eqeqeq: "error", // Enforce strict equality
      "no-var": "warn", // Disallow using var
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }], // Disallow unused variables
    },
    ignores: ["node_modules/**/*", "dist/**/*"], // Ignore node_modules and dist directories
  },

  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
];
