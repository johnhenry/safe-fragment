import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

/**
 * Separate config for test/examples/ only -- those tests import the built
 * examples' main.mjs modules (each one imports ../../dist/index.js), so
 * they only make sense after `npm run build`. Kept out of
 * vitest.config.ts's default include so a plain `npm test` never depends
 * on a build having already happened. Run via `npm run examples` (which
 * builds first).
 */
export default defineConfig({
  test: {
    include: ["test/examples/**/*.test.ts"],
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
