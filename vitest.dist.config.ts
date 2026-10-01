import { defineConfig } from "vitest/config";

/**
 * Node-environment checks against the BUILT package (`npm run build` first):
 * both module formats load together in Node with no DOM, and share state.
 * Run via `npm run test:dist`.
 */
export default defineConfig({
  test: {
    include: ["test/dist/**/*.test.ts"],
    environment: "node",
  },
});
