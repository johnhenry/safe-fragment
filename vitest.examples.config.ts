import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

/**
 * Browsers to run. Default: all three engines (CI). Locally, narrow it with
 * e.g. `SF_BROWSERS=chromium,webkit npm test` (Firefox may not launch in some sandboxes).
 */
const BROWSERS = (process.env.SF_BROWSERS ?? "chromium,webkit,firefox")
  .split(",")
  .map((b) => b.trim())
  .filter(Boolean) as Array<"chromium" | "webkit" | "firefox">;

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
      instances: BROWSERS.map((browser) => ({ browser })),
    },
  },
});
