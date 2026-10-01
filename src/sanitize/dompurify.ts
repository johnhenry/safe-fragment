import type { BaselineConfig } from "./config.js";
import { SafeFragmentError } from "../errors.js";

/**
 * Narrow slice of the DOMPurify instance surface this module actually
 * uses, so the rest of the file doesn't need `@types/dompurify` in scope
 * everywhere.
 */
interface DOMPurifyLike {
  addHook(name: string, hook: (node: Element) => void): void;
  sanitize(dirty: string, config: Record<string, unknown>): DocumentFragment;
}

type DOMPurifyFactory = (window: Window) => DOMPurifyLike;

/**
 * Sanitizes `html` via DOMPurify, configured with an explicit, closed
 * allowlist derived from the profile -- **never** DOMPurify's out-of-the-box
 * defaults (which allow a large general-purpose HTML tag/attribute set).
 * `ALLOWED_TAGS`/`ALLOWED_ATTR` fully replace DOMPurify's own default
 * allowlist rather than extending it.
 *
 * `dompurify` is imported dynamically (not as a static top-level import of
 * this module or its caller) specifically so that importing
 * `@johnhenry/safe-fragment` in Node/SSR -- where no DOM exists at all --
 * never triggers DOMPurify's own module-init code path. The import only
 * happens here, inside a function that itself is only ever invoked with a
 * real `Document`/`Window` at render time.
 */
export async function sanitizeWithDOMPurify(doc: Document, html: string, baseline: BaselineConfig): Promise<DocumentFragment> {
  const win = doc.defaultView;
  if (!win) {
    throw new SafeFragmentError("SANITIZER_UNAVAILABLE", "DOMPurify fallback requires a Document with a defaultView (Window); none is available.");
  }

  let createDOMPurify: DOMPurifyFactory;
  try {
    const mod = (await import("dompurify")) as unknown as { default: DOMPurifyFactory };
    createDOMPurify = mod.default;
  } catch (cause) {
    throw new SafeFragmentError("SANITIZER_UNAVAILABLE", "Failed to load the DOMPurify fallback module.", { cause });
  }

  let purify: DOMPurifyLike;
  try {
    purify = createDOMPurify(win);
  } catch (cause) {
    throw new SafeFragmentError("SANITIZER_UNAVAILABLE", "Failed to initialize DOMPurify against the target window.", { cause });
  }

  // DOMPurify force-removes (subtree and all) any element carrying `is=`; the
  // native engine just drops the attribute. Normalize to the latter so both
  // engines keep the element and lose only the customized-built-in hook.
  purify.addHook("beforeSanitizeAttributes", (node) => {
    if (node.nodeType === 1 && node.hasAttribute("is")) node.removeAttribute("is");
  });

  try {
    const fragment = purify.sanitize(html, {
      // The locked allowlist -- see module doc comment above.
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
      // content -- see docs/adr/0002 for the full explanation). Any stray
      // text DOMPurify promotes up from a disallowed element it removes is
      // still fully inert (never re-parsed as markup); enforceProfile
      // (src/sanitize/enforce.ts), which runs after this engine
      // regardless, is the actual authoritative allowlist boundary for
      // which *elements* survive, not this flag.
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
            tagNameCheck: (tag: string) => baseline.allowedElements.includes(tag),
            attributeNameCheck: () => true, // enforceProfile is authoritative for attribute names per element
            allowCustomizedBuiltInElements: false,
          }
        : undefined,
    });
    return fragment;
  } catch (cause) {
    throw new SafeFragmentError("SANITIZE_FAILED", "DOMPurify threw while sanitizing input.", { cause });
  }
}
