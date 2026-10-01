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
 * Real browser tests, not jsdom -- required for genuine confidence in
 * custom-element lifecycle, Shadow DOM, and sanitizer behavior (jsdom does
 * not implement the HTML Sanitizer API / `Element.prototype.setHTML` at
 * all, which is exactly the code path this package most needs covered).
 * Runs headless Chromium via Playwright.
 */
export default defineConfig({
  test: {
    // test/examples is deliberately excluded from the default run: those
    // tests import the *built* examples/*/main.mjs (which import
    // ../../dist/index.js), so they only make sense after `npm run
    // build`. Run them via `npm run examples` (which builds first), not
    // plain `npm test` -- a fresh `npm ci && npm test` with no build step
    // should not fail just because dist/ doesn't exist yet.
    include: process.env.SF_FUZZ_ONLY
      ? ["test/fuzz/**/*.test.ts"]
      : ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts", "test/security/**/*.test.ts", "test/fuzz/**/*.test.ts"],
    // Single worker: multiple concurrent Playwright browser contexts were
    // occasionally causing a "Browser connection was closed" flake under
    // resource contention. Test files still run in one shared page
    // sequentially, which is fast enough for this suite's size and much
    // more reliable than parallel browser instances.
    fileParallelism: false,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: BROWSERS.map((browser) => ({ browser })),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
    },
  },
});
