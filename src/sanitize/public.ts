import type { SanitizationReport, IdPolicy } from "../types.js";
import { SafeFragmentError } from "../errors.js";
import { getProfile } from "../policy/registry.js";
import { getGlobalDocument } from "../platform/environment.js";
import { sanitize, sanitizeSync } from "./index.js";
import type { DOMPurifyLoader } from "./dompurify.js";

export interface SanitizeToFragmentOptions {
  /** Name of a registered profile (a built-in, or one added with `registerProfile`). Required; there is no default. */
  profile: string;
  /** The document whose realm should be used (e.g. a popout's). Defaults to the ambient `document`. */
  document?: Document;
  /** Largest accepted input in UTF-16 code units (default 1,000,000); longer input throws `SOURCE_TOO_LARGE`. */
  maxInputLength?: number;
  /** Base URL that protocol-relative URLs inherit their scheme from. Defaults to `document.baseURI`. */
  baseUrl?: string;
  /**
   * `"prefix"` (default) rewrites every id (and reference) to `user-content-*`.
   * `"keep-in-shadow"` keeps ids as written and is safe ONLY if you insert the
   * returned fragment into a shadow root: in light DOM or the document, a
   * kept id can clobber `window`/`document` properties. Nothing here can check
   * where you insert it; that guarantee is yours (docs/adr/0005).
   */
  idPolicy?: IdPolicy;
  /** DOMPurify loader for this call (see `registerSafeFragment({ loadDOMPurify })`). */
  loadDOMPurify?: DOMPurifyLoader;
}

export interface SanitizeToFragmentResult {
  /** A detached, fully profile-conformant fragment. Insert it with `append`/`replaceChildren`; it is never touched by an unsafe sink. */
  fragment: DocumentFragment;
  /** What was removed or rewritten (engine removals and `enforceProfile`'s), plus timing and sizes. */
  report: SanitizationReport;
}

function resolve(options: SanitizeToFragmentOptions) {
  if (typeof options !== "object" || options === null || typeof options.profile !== "string" || options.profile === "") {
    throw new SafeFragmentError("INVALID_PROFILE", "sanitizeToFragment() requires options.profile: the name of a registered profile.");
  }
  const profile = getProfile(options.profile);
  if (!profile) throw new SafeFragmentError("UNKNOWN_PROFILE", `Unknown profile "${options.profile}".`, { details: { profile: options.profile } });
  const doc = options.document ?? getGlobalDocument();
  if (!doc) {
    throw new SafeFragmentError("UNSUPPORTED_ENVIRONMENT", "sanitizeToFragment() needs a DOM. Pass options.document, or call it from browser code.");
  }
  return { profile, doc };
}

/**
 * Sanitizes `html` under a named profile and returns a detached
 * `DocumentFragment` plus a `SanitizationReport`. This is the same pipeline
 * `<safe-fragment>` uses (engine -> `enforceProfile` -> rebuild); the element
 * is just a consumer of it. Use it where a template or markup string must be
 * sanitized without a custom element, e.g. as the sanitizer hook of a
 * component/template system. Throws a `SafeFragmentError` on failure -- never
 * returns a partially sanitized result.
 */
export async function sanitizeToFragment(html: string, options: SanitizeToFragmentOptions): Promise<SanitizeToFragmentResult> {
  const { profile, doc } = resolve(options);
  return sanitize(doc, html, profile, {
    maxInputLength: options.maxInputLength,
    baseUrl: options.baseUrl,
    loadDOMPurify: options.loadDOMPurify,
    idPolicy: options.idPolicy,
  });
}

/**
 * Synchronous variant of `sanitizeToFragment`. It works only when no
 * loading is needed: the native Sanitizer API exists, or DOMPurify was
 * already prepared (`await preloadSanitizer()`, or an earlier async call).
 * Otherwise it throws `SANITIZER_NOT_READY` -- it fails closed, it never
 * degrades to an unsanitized or lesser path.
 */
export function sanitizeToFragmentSync(html: string, options: SanitizeToFragmentOptions): SanitizeToFragmentResult {
  const { profile, doc } = resolve(options);
  return sanitizeSync(doc, html, profile, { maxInputLength: options.maxInputLength, baseUrl: options.baseUrl, idPolicy: options.idPolicy });
}
