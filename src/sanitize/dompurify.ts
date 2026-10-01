import type { BaselineConfig } from "./config.js";
import type { SanitizationNote } from "../types.js";
import { SafeFragmentError } from "../errors.js";
import { getSharedState, type SharedState } from "../shared-state.js";

/**
 * Narrow slice of the DOMPurify instance surface this module actually
 * uses, so the rest of the code doesn't need `@types/dompurify` in scope.
 */
export interface DOMPurifyLike {
  addHook(name: string, hook: (node: Element, data?: unknown) => void): void;
  sanitize(dirty: string, config: Record<string, unknown>): DocumentFragment;
  /** DOMPurify's own log of what the last `sanitize()` call removed. */
  removed?: ReadonlyArray<{ element?: Node; attribute?: Attr | null; from?: Node }>;
  isSupported?: boolean;
}

/** `createDOMPurify`: the callable default export of the `dompurify` module (`(window) => instance`). */
export type DOMPurifyFactory = (window: Window) => DOMPurifyLike;

/** Supplies the DOMPurify factory. See `RegisterSafeFragmentOptions.loadDOMPurify`. */
export type DOMPurifyLoader = () => Promise<DOMPurifyFactory>;

/** The custom-element tag predicate of the sanitize() call currently running on an instance (sanitization is synchronous, so this is never contended). */
const activeTagChecks = new WeakMap<DOMPurifyLike, (tag: string) => boolean>();

const FIX_HINT =
  "Add `dompurify` to your page's import map (or bundle it), or pass `loadDOMPurify: () => import(url).then((m) => m.default)` to registerSafeFragment() / preloadSanitizer().";

// State lives in the shared (globalThis-keyed) store so the ESM and CJS
// builds of this package share ONE instance cache and loader.
function purifyState(): NonNullable<SharedState["purify"]> {
  const shared = getSharedState();
  return (shared.purify ??= { instances: new WeakMap() });
}

/** Sets the app-wide DOMPurify loader (called by `registerSafeFragment({ loadDOMPurify })`). */
export function setDOMPurifyLoader(loader: DOMPurifyLoader | undefined): void {
  purifyState().loader = loader;
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
  const st = purifyState();
  const effective = loader ?? st.loader ?? defaultLoader;
  if (st.factoryPromise && st.factoryLoaderUsed === effective) return st.factoryPromise;
  st.factoryLoaderUsed = effective;
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
  st.factoryPromise = promise;
  promise.catch(() => {
    // Allow a later retry (e.g. after the import map is fixed) instead of caching the failure forever.
    if (st.factoryPromise === promise) st.factoryPromise = undefined;
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
  const instances = purifyState().instances;
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
  // Custom elements and profile drop-elements: DOMPurify's own "basic custom element" test rejects
  // valid names with consecutive hyphens (`ui--card`), so exact tags and
  // prefix patterns are allowed through its documented element hook instead,
  // using the profile of the call currently in progress.
  purify.addHook("uponSanitizeElement", (node, data) => {
    const check = activeTagChecks.get(purify);
    const d = data as unknown as { tagName?: string; allowedTags?: Record<string, boolean> } | undefined;
    if (check && d?.tagName && d.allowedTags && check(d.tagName)) d.allowedTags[d.tagName] = true;
    void node;
  });
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
  return win ? purifyState().instances.get(win) : undefined;
}

export interface DOMPurifyOutput {
  fragment: DocumentFragment;
  /** What DOMPurify itself removed before `enforceProfile` ran (it never reports why). */
  removedElements: SanitizationNote[];
  removedAttributes: SanitizationNote[];
}

/**
 * What DOMPurify's parser sees before the input. DOMPurify parses a whole
 * document with `DOMParser`, and two things about that parse differ from the
 * native engine's `<div>` of a standards-mode inert document:
 *
 * - **Compat mode.** No doctype means quirks mode, where `<table>` does not
 *   close an open `<p>`, so `<p><table>` nested on DOMPurify and split on native
 *   (found by the fuzzer, D2). A doctype makes it standards mode.
 * - **Where content lands.** A leading `<noscript>`/`<title>`/`<style>` parses into
 *   `<head>`, and a `<frameset>` that reaches the body REPLACES it (DOMPurify then
 *   has no body and returns `""`, D1). DOMPurify's own `FORCE_BODY` prefixes an
 *   unknown `<remove></remove>` for the first reason only. `<xmp></xmp>` does both
 *   jobs: it starts the body, and a start tag `xmp` sets the "frameset-ok" flag to
 *   "not ok", so a later `<frameset>` is ignored exactly as in a `<div>` context.
 *   `xmp` is in the drop-subtree list, so the sentinel never reaches the output.
 *
 * DOMPurify's `FORCE_BODY` is therefore off and the prefix is ours (ADR 0004).
 */
const PARSE_PREFIX = "<!DOCTYPE html><xmp></xmp>";
const SENTINEL_TAG = "xmp";

/**
 * Whether an entry of DOMPurify's `removed` log is a node the INPUT contained.
 * The log also records DOMPurify's own scaffolding: the empty `<xmp></xmp>`
 * sentinel of `PARSE_PREFIX` (the first element removed) and the parsed
 * `<body>` wrapper (not in any profile's allowlist, so "removed"). Neither is
 * input; comments and text nodes are not elements and are never reported.
 * The parser never yields a `<body>`/`<html>`/`<head>` element from body
 * context markup, so skipping those names cannot hide an author's element.
 * (safe-fragment#9)
 */
function isGenuineRemoval(node: Node, seenSentinel: { done: boolean }): boolean {
  if (node.nodeType !== 1) return false;
  const name = node.nodeName.toLowerCase();
  if (name === "body" || name === "html" || name === "head") return false;
  if (!seenSentinel.done && name === SENTINEL_TAG && node.childNodes.length === 0 && (node as Element).attributes.length === 0) {
    seenSentinel.done = true;
    return false;
  }
  return true;
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
  // Tags DOMPurify must leave alone for enforceProfile to judge: the profile's custom elements, and the elements it
  // drops with their subtree (`dropElements`, e.g. email's v:*): DOMPurify would otherwise unwrap those and leak their text.
  activeTagChecks.set(
    purify,
    (tag) => (baseline.allowCustomElements && tag.includes("-") && baseline.customElementTagCheck(tag)) || baseline.profileDropElementCheck(tag),
  );
  try {
    fragment = purify.sanitize(PARSE_PREFIX + html, {
      // The locked allowlist -- see function doc comment above.
      ALLOWED_TAGS: baseline.allowedElements,
      ALLOWED_ATTR: baseline.allowedAttributes,
      ALLOW_DATA_ATTR: false,
      // True: with false, DOMPurify drops any non-URL attribute whose value
      // merely looks like `scheme:` (`exportparts="a:b"`, `data-action="cart:add"`)
      // while the native engine keeps it. `javascript:`/`vbscript:`/`data:` values
      // are still refused by DOMPurify itself, and every URL-valued attribute goes
      // through checkUrl in enforceProfile, which is the actual scheme gate for
      // both engines.
      ALLOW_UNKNOWN_PROTOCOLS: true,
      ALLOW_SELF_CLOSE_IN_ATTR: false,
      WHOLE_DOCUMENT: false,
      // Off: the parse prefix above does the job of FORCE_BODY (and more).
      FORCE_BODY: false,
      // Off: it would drop any id/name value that collides with a document or
      // form property (`<slot name="title">`, `<p id="title">`) on this engine
      // only. enforceProfile namespaces ids AND clobberable `name`s itself,
      // identically for both engines (safe-fragment#11).
      SANITIZE_DOM: false,
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
    });
  } catch (cause) {
    throw new SafeFragmentError("SANITIZE_FAILED", "DOMPurify threw while sanitizing input.", { cause });
  } finally {
    activeTagChecks.delete(purify);
  }

  // DOMPurify hands back the input string unchanged when it is unsupported
  // in this window; never let that through as if it were a sanitized tree.
  if (typeof fragment !== "object" || fragment === null || fragment.nodeType !== 11) {
    throw new SafeFragmentError("SANITIZE_FAILED", "DOMPurify did not return a DocumentFragment.");
  }

  const removedElements: SanitizationNote[] = [];
  const removedAttributes: SanitizationNote[] = [];
  const log = purify.removed ?? [];
  const sentinel = { done: false };
  for (let i = 0; i < log.length; i++) {
    const entry = log[i]!;
    if (entry.attribute) {
      removedAttributes.push({
        tag: (entry.from?.nodeName ?? "").toLowerCase(),
        attribute: entry.attribute.name.toLowerCase(),
        reason: "removed-by-engine:dompurify",
      });
    } else if (entry.element && isGenuineRemoval(entry.element, sentinel)) {
      removedElements.push({ tag: entry.element.nodeName.toLowerCase(), reason: "removed-by-engine:dompurify" });
    }
  }
  return { fragment, removedElements, removedAttributes };
}
