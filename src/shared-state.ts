import type { ProfileDefinition } from "./policy/profile.js";
import type { DOMPurifyFactory, DOMPurifyLike, DOMPurifyLoader } from "./sanitize/dompurify.js";

/**
 * Process-wide state shared by every copy of this package that ends up on
 * the page. The package ships as ESM and CJS; an application (or a
 * dependency of it) can easily load both, and each build would otherwise
 * get its OWN profile registry and its OWN DOMPurify-instance cache: a
 * profile registered through one build would be "unknown" to the other, and
 * a second DOMPurify instance per window would re-register the Trusted Types
 * `dompurify` policy. The state therefore lives on `globalThis` under a
 * `Symbol.for` key, created lazily (never at module top level).
 */
export interface SharedState {
  profiles?: Map<string, ProfileDefinition>;
  builtinNames?: Set<string>;
  purify?: {
    instances: WeakMap<object, DOMPurifyLike>;
    loader?: DOMPurifyLoader;
    factoryPromise?: Promise<DOMPurifyFactory>;
    factoryLoaderUsed?: DOMPurifyLoader;
  };
}

const KEY = Symbol.for("@johnhenry/safe-fragment/shared-state/v1");

export function getSharedState(): SharedState {
  const g = globalThis as unknown as Record<symbol, SharedState | undefined>;
  let state = g[KEY];
  if (!state) {
    state = {};
    Object.defineProperty(g, KEY, { value: state, enumerable: false, configurable: false, writable: false });
  }
  return state;
}
