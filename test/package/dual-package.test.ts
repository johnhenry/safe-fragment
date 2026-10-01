import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import type * as Api from "../../src/index.js";

/**
 * The package ships ESM and CJS builds, and an application can load both
 * (its own code as ESM, a dependency via require). Each build is a separate
 * module instance, so without shared state they would have separate profile
 * registries, and `instanceof SafeFragmentError` would fail across them. Runs
 * in plain Node against the BUILT files (`npm run build` first) -- which also
 * proves both builds are importable with no DOM present.
 */
const here = dirname(fileURLToPath(import.meta.url));
const esmPath = resolve(here, "../../dist/index.js");
const cjsPath = resolve(here, "../../dist/index.cjs");

describe("dual package (ESM + CJS builds loaded together)", async () => {
  const esm = (await import(esmPath)) as typeof Api;
  const cjs = createRequire(import.meta.url)(cjsPath) as typeof Api;

  it("loads both builds in Node with no DOM", () => {
    expect(typeof globalThis.document).toBe("undefined");
    expect(typeof esm.registerSafeFragment).toBe("function");
    expect(typeof cjs.registerSafeFragment).toBe("function");
    expect(esm).not.toBe(cjs);
  });

  it("shares one profile registry: a profile registered via ESM is visible to CJS, and vice versa", () => {
    const viaEsm = esm.registerProfile({
      name: "dual-esm-v1",
      version: 1,
      mode: "html",
      elements: { p: [] },
      urlAttributes: [],
      urlSchemes: ["relative"],
      allowedDataAttributes: [],
      allowStyleAttribute: false,
      customElements: [],
      blockRelativeAutoLoadUrls: false,
    });
    expect(cjs.getProfile("dual-esm-v1")).toBe(viaEsm);
    expect(cjs.listProfiles()).toContain("dual-esm-v1");
    // ...and a duplicate through the OTHER build is refused, because it is the same registry.
    expect(() => cjs.registerProfile({ ...viaEsm })).toThrowError(/already registered/);
    expect(cjs.unregisterProfile("dual-esm-v1")).toBe(true);
    expect(esm.getProfile("dual-esm-v1")).toBeUndefined();
    expect(esm.getProfile("article-v1")).toBe(cjs.getProfile("article-v1"));
  });

  it("instanceof SafeFragmentError works across builds", () => {
    expect(esm.SafeFragmentError).not.toBe(cjs.SafeFragmentError);
    const fromEsm = new esm.SafeFragmentError("NO_SOURCE", "x");
    const fromCjs = new cjs.SafeFragmentError("NO_SOURCE", "x");
    expect(fromEsm instanceof cjs.SafeFragmentError).toBe(true);
    expect(fromCjs instanceof esm.SafeFragmentError).toBe(true);
    expect(fromEsm instanceof Error).toBe(true);
    expect(new Error("plain") instanceof esm.SafeFragmentError).toBe(false);
    expect(cjs.isSafeFragmentError(fromEsm)).toBe(true);
  });

  it("errors from a build surface with the stable code", () => {
    try {
      cjs.registerProfile(undefined as never);
      expect.unreachable();
    } catch (error) {
      expect(esm.isSafeFragmentError(error) && error.code).toBe("INVALID_PROFILE");
    }
  });

  it("both declaration files type document.createElement('safe-fragment') (appended by scripts/append-dts.mjs; JSR refuses global augmentations in src)", () => {
    for (const file of ["../../dist/index.d.ts", "../../dist/index.d.cts"]) {
      const text = readFileSync(resolve(here, file), "utf8");
      expect(text, file).toContain("declare global");
      expect(text, file).toContain('"safe-fragment": SafeFragmentElement');
    }
  });
});
