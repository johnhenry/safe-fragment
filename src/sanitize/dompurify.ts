import type { BaselineConfig } from "./config.js";
import type { SanitizationNote } from "../types.js";
import { SafeFragmentError } from "../errors.js";

/**
 * Narrow slice of the DOMPurify instance surface this module actually
 * uses, so the rest of the code doesn't need `@types/dompurify` in scope.
 */
export interface DOMPurifyLike {
  addHook(name: string, hook: (node: Element) => void): void;
  sanitize(dirty: string, config: Record<string, unknown>): DocumentFragment;
  /** DOMPurify's own log of what the last `sanitize()` call removed. */
  removed?: ReadonlyArray<{ element?: Node; attribute?: Attr | null; from?: Node }>;
  isSupported?: boolean;
}

/** `createDOMPurify`: the callable default export of the `dompurify` module (`(window) => instance`). */
export type DOMPurifyFactory = (window: Window) => DOMPurifyLike;

/** Supplies the DOMPurify factory. See `RegisterSafeFragmentOptions.loadDOMPurify`. */
export type DOMPurifyLoader = () => Promise<DOMPurifyFactory>;

const FIX_HINT =
  "Add `dompurify` to your page's import map (or bundle it), or pass `loadDOMPurify: () => import(url).then((m) => m.default)` to registerSafeFragment() / preloadSanitizer().";

// Module-level state is fine here: none of it touches a DOM global.
let configuredLoader: DOMPurifyLoader | undefined;
let factoryPromise: Promise<DOMPurifyFactory> | undefined;
let factoryLoaderUsed: DOMPurifyLoader | undefined;
const instances = new WeakMap<object, DOMPurifyLike>();

/** Sets the app-wide DOMPurify loader (called by `registerSafeFragment({ loadDOMPurify })`). */
export function setDOMPurifyLoader(loader: DOMPurifyLoader | undefined): void {
  configuredLoader = loader;
}

/**
 * The default loader: a dynamic `import("dompurify")`, so importing this
 * package in Node/SSR never triggers DOMPurify's own module-init path and
 * so a bundler/import map decides where it comes from.
 */
const defaultLoader: DOMPurifyLoader = async () => {
  const mod = (await import("dompurify")) as unknown as { default: DOMPurifyFactory };
  return mod.default;
};

function loadFactory(loader: DOMPurifyLoader | undefined): Promise<DOMPurifyFactory> {
  const effective = loader ?? configuredLoader ?? defaultLoader;
  if (factoryPromise && factoryLoaderUsed === effective) return factoryPromise;
  factoryLoaderUsed = effective;
  const promise = (async () => {
    try {
      const loaded = (await effective()) as unknown as DOMPurifyFactory | { default?: DOMPurifyFactory };
      const factory = typeof loaded === "function" ? loaded : loaded?.default;
      if (typeof factory !== "function") throw new TypeError("the loader did not resolve to a DOMPurify factory function");
      return factory;
    } catch (cause) {
      throw new SafeFragmentError("SANITIZER_UNAVAILABLE", `Failed to load the DOMPurify fallback sanitizer. ${FIX_HINT}`, { cause });
    }
  })();
  factoryPromise = promise;
  promise.catch(() => {
    // Allow a later retry (e.g. after the import map is fixed) instead of caching the failure forever.
    if (factoryPromise === promise) factoryPromise = undefined;
  });
  return promise;
}

/**
 * Returns the ONE DOMPurify instance for `win`, creating it on first use.
 * Instances are cached per window: `createDOMPurify(win)` registers a
 * Trusted Types policy named `dompurify`, and a CSP such as
 * `trusted-types dompurify` (without `'allow-duplicates'`) rejects the
 * second registration -- re-creating an instance per render broke every
 * render after the first under such a policy.
 */
export async function getDOMPurify(win: Window, loader?: DOMPurifyLoader): Promise<DOMPurifyLike> {
  const cached = instances.get(win);
  if (cached) return cached;
  const factory = await loadFactory(loader);
  const raced = instances.get(win); // another render may have created it while we awaited
  if (raced) return raced;
  let purify: DOMPurifyLike;
  try {
    purify = factory(win);
  } catch (cause) {
    throw new SafeFragmentError("SANITIZER_UNAVAILABLE", "Failed to initialize DOMPurify against the target window.", { cause });
  }
  if (purify.isSupported === false) {
    throw new SafeFragmentError("SANITIZER_UNAVAILABLE", "DOMPurify reports that this window is not supported (missing DOM features).");
  }
  // DOMPurify force-removes (subtree and all) any element carrying `is=`; the
  // native engine just drops the attribute. Normalize to the latter so both
  // engines keep the element and lose only the customized-built-in hook (the
  // hidden is-value itself is removed by rebuildFragment).
  purify.addHook("beforeSanitizeAttributes", (node) => {
    if (node.nodeType === 1 && node.hasAttribute("is")) node.removeAttribute("is");
  });
  instances.set(win, purify);
  return purify;
}

/** The already-created DOMPurify instance for `win`, if any -- the synchronous API's only way to reach DOMPurify. */
export function peekDOMPurify(win: Window | null | undefined): DOMPurifyLike | undefined {
  return win ? instances.get(win) : undefined;
}

export interface DOMPurifyOutput {
  fragment: DocumentFragment;
  /** What DOMPurify itself removed before `enforceProfile` ran (it never reports why). */
  removedElements: SanitizationNote[];
  removedAttributes: SanitizationNote[];
}

/**
 * Sanitizes `html` via DOMPurify, configured with an explicit, closed
 * allowlist derived from the profile -- **never** DOMPurify's out-of-the-box
 * defaults (which allow a large general-purpose HTML tag/attribute set).
 * `ALLOWED_TAGS`/`ALLOWED_ATTR` fully replace DOMPurify's own default
 * allowlist rather than extending it.
 */
export function sanitizeWithDOMPurify(purify: DOMPurifyLike, html: string, baseline: BaselineConfig): DOMPurifyOutput {
  let fragment: DocumentFragment;
  try {
    fragment = purify.sanitize(html, {
      // The locked allowlist -- see function doc comment above.
      ALLOWED_TAGS: baseline.allowedElements,
      ALLOWED_ATTR: baseline.allowedAttributes,
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      ALLOW_SELF_CLOSE_IN_ATTR: false,
      WHOLE_DOCUMENT: false,
      // Parse in <body> context, like the native engine's <div> context.
      // Without it a leading <noscript>/<title>/<style>/<meta> is parsed into
      // <head> and the two engines diverge (ADR 0004).
      FORCE_BODY: true,
      SANITIZE_DOM: true,
      // Deliberately false: enforceProfile namespaces every id itself
      // (identically for both engines) and rewrites references; letting
      // DOMPurify prefix too would double-prefix and desync references.
      SANITIZE_NAMED_PROPS: false,
      // KEEP_CONTENT: true is required for DOMPurify to keep ordinary text
      // nodes inside ALLOWED elements at all (its ALLOWED_TAGS list is
      // otherwise interpreted as also excluding "#text" itself, which
      // silently strips every text node, not just disallowed-element
      // content -- see docs/adr/0002 for the full explanation).
      KEEP_CONTENT: true,
      // Replaces (not extends) DOMPurify's default FORBID_CONTENTS so the
      // set of subtree-dropped elements is exactly ours, identical to the
      // native engine's `removeElements` and enforceProfile's drop list
      // (ADR 0004). Every other disallowed element is unwrapped.
      FORBID_CONTENTS: baseline.dropSubtreeElements,

      RETURN_DOM_FRAGMENT: true,
      RETURN_DOM: false,
      CUSTOM_ELEMENT_HANDLING: baseline.allowCustomElements
        ? {
            tagNameCheck: baseline.customElementTagCheck,
            attributeNameCheck: () => true, // enforceProfile is authoritative for attribute names per element
            allowCustomizedBuiltInElements: false,
          }
        : undefined,
    });
  } catch (cause) {
    throw new SafeFragmentError("SANITIZE_FAILED", "DOMPurify threw while sanitizing input.", { cause });
  }

  // DOMPurify hands back the input string unchanged when it is unsupported
  // in this window; never let that through as if it were a sanitized tree.
  if (typeof fragment !== "object" || fragment === null || fragment.nodeType !== 11) {
    throw new SafeFragmentError("SANITIZE_FAILED", "DOMPurify did not return a DocumentFragment.");
  }

  const removedElements: SanitizationNote[] = [];
  const removedAttributes: SanitizationNote[] = [];
  for (const entry of purify.removed ?? []) {
    if (entry.attribute) {
      removedAttributes.push({
        tag: (entry.from?.nodeName ?? "").toLowerCase(),
        attribute: entry.attribute.name.toLowerCase(),
        reason: "removed-by-engine:dompurify",
      });
    } else if (entry.element) {
      removedElements.push({ tag: entry.element.nodeName.toLowerCase(), reason: "removed-by-engine:dompurify" });
    }
  }
  return { fragment, removedElements, removedAttributes };
}
