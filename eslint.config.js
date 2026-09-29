// @ts-check
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["examples/**/*.mjs", "*.config.ts", "*.config.js"],
    rules: {
      "@typescript-eslint/no-var-requires": "off",
    },
  },
  eslintConfigPrettier,
);
