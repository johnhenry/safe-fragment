import type { ProfileDefinition } from "../policy/profile.js";
import type { SanitizationReport, SanitizationNote } from "../types.js";
import { SafeFragmentError } from "../errors.js";
import { hasNativeSanitizer } from "./capabilities.js";
import { buildBaselineConfig } from "./config.js";
import { sanitizeWithNative } from "./native.js";
import { sanitizeWithDOMPurify, getDOMPurify, peekDOMPurify, type DOMPurifyLoader } from "./dompurify.js";
import { enforceProfile } from "./enforce.js";
import { rebuildWithLength } from "./rebuild.js";

/** Default cap on the markup string handed to a sanitizer (UTF-16 code units); see `SanitizeOptions.maxInputLength`. */
export const DEFAULT_MAX_INPUT_LENGTH = 1_000_000;

function assertInputWithinLimit(html: string, options: SanitizeOptions): void {
  const limit = options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
  if (typeof html !== "string") {
    throw new SafeFragmentError("INVALID_SOURCE", `The markup source must be a string, got ${html === null ? "null" : typeof html}.`);
  }
  if (html.length > limit) {
    throw new SafeFragmentError("SOURCE_TOO_LARGE", `The markup source is ${html.length} characters; the limit is ${limit} (maxInputLength).`, {
      details: { length: html.length, limit },
    });
  }
}

export interface SanitizeOptions {
  /**
   * Largest accepted input, in UTF-16 code units (default 1,000,000). The
   * DOMPurify fallback removes nodes one at a time and is quadratic on
   * inputs with very many removed elements (100k of them took 12-47 s), so an
   * unbounded string is a denial-of-service lever. Raise it deliberately.
   */
  maxInputLength?: number;
  /** Force a specific engine, bypassing feature detection. Test-only; not exposed on the public custom-element API. */
  forceEngine?: "native" | "dompurify";
  /** True if the input was truncated upstream (e.g. by the `src` fetch size cap) before reaching the sanitizer. */
  truncated?: boolean;
  /** Base URL protocol-relative URLs inherit their scheme from; defaults to `doc.baseURI`. */
  baseUrl?: string;
  /** Per-call DOMPurify loader; defaults to the one set via `registerSafeFragment`/`preloadSanitizer`, then to `import("dompurify")`. */
  loadDOMPurify?: DOMPurifyLoader;
}

export interface SanitizeResult {
  fragment: DocumentFragment;
  report: SanitizationReport;
}

/**
 * The single sanitization entry point. Picks an engine (native Sanitizer
 * API when available, DOMPurify otherwise), parses `html` into a detached,
 * inert `DocumentFragment`, then runs the shared `enforceProfile` pass --
 * the actual allowlist boundary -- identically regardless of which engine
 * did the parsing.
 *
 * `plain-text-v1` (and any future `mode: "text"` profile) never reaches
 * either engine at all: the input is wrapped in a single `Text` node, with
 * no HTML parser invoked on it whatsoever.
 *
 * Throws `SafeFragmentError` (never returns a partially-sanitized result)
 * if sanitization cannot be completed safely -- callers must treat a throw
 * here as "do not render", not as "render whatever we got back".
 */
export async function sanitize(doc: Document, html: string, profile: ProfileDefinition, options: SanitizeOptions = {}): Promise<SanitizeResult> {
  const start = nowMs();
  assertInputWithinLimit(html, options);
  if (profile.mode === "text") return textResult(doc, html, profile, options, start);

  const baseline = buildBaselineConfig(profile);
  const useNative = options.forceEngine === "native" || (options.forceEngine === undefined && hasNativeSanitizer(doc));

  if (useNative) {
    const out = sanitizeWithNative(doc, html, baseline);
    return finish(doc, out.fragment, "native", out.removedElements, out.removedAttributes, html, profile, options, start);
  }

  const win = doc.defaultView;
  if (!win) {
    throw new SafeFragmentError("SANITIZER_UNAVAILABLE", "DOMPurify fallback requires a Document with a defaultView (Window); none is available.");
  }
  const purify = await getDOMPurify(win, options.loadDOMPurify);
  const out = sanitizeWithDOMPurify(purify, html, baseline);
  return finish(doc, out.fragment, "dompurify", out.removedElements, out.removedAttributes, html, profile, options, start);
}

/**
 * Synchronous variant. Works only when an engine is ready without any
 * `await`: the native Sanitizer API exists, or DOMPurify was already
 * created for this window (via `preloadSanitizer()` or a previous async
 * render). Otherwise it throws `SANITIZER_NOT_READY` -- it never falls back
 * to anything less safe.
 */
export function sanitizeSync(doc: Document, html: string, profile: ProfileDefinition, options: SanitizeOptions = {}): SanitizeResult {
  const start = nowMs();
  assertInputWithinLimit(html, options);
  if (profile.mode === "text") return textResult(doc, html, profile, options, start);

  const baseline = buildBaselineConfig(profile);
  const useNative = options.forceEngine === "native" || (options.forceEngine === undefined && hasNativeSanitizer(doc));
  if (useNative) {
    const out = sanitizeWithNative(doc, html, baseline);
    return finish(doc, out.fragment, "native", out.removedElements, out.removedAttributes, html, profile, options, start);
  }
  const purify = peekDOMPurify(doc.defaultView);
  if (!purify) {
    throw new SafeFragmentError(
      "SANITIZER_NOT_READY",
      "No sanitizer is ready synchronously: this browser has no native Sanitizer API (Element.setHTML) and DOMPurify has not been loaded yet. " +
        "Call `await preloadSanitizer()` first, or use the async sanitizeToFragment().",
    );
  }
  const out = sanitizeWithDOMPurify(purify, html, baseline);
  return finish(doc, out.fragment, "dompurify", out.removedElements, out.removedAttributes, html, profile, options, start);
}

function textResult(doc: Document, html: string, profile: ProfileDefinition, options: SanitizeOptions, start: number): SanitizeResult {
  const fragment = doc.createDocumentFragment();
  fragment.appendChild(doc.createTextNode(html));
  return {
    fragment,
    report: {
      profile: profile.name,
      engine: "native", // no engine ran; nominal value, not user-observable behavior
      removedElements: [],
      removedAttributes: [],
      rewrittenUrls: [],
      durationMs: nowMs() - start,
      inputLength: html.length,
      outputLength: html.length,
      truncated: options.truncated ?? false,
    },
  };
}

function finish(
  doc: Document,
  engineFragment: DocumentFragment,
  engine: "native" | "dompurify",
  engineRemovedElements: SanitizationNote[],
  engineRemovedAttributes: SanitizationNote[],
  html: string,
  profile: ProfileDefinition,
  options: SanitizeOptions,
  start: number,
): SanitizeResult {
  const enforced = enforceProfile(engineFragment, profile, { baseUrl: options.baseUrl ?? doc.baseURI });
  const { fragment, length } = rebuildWithLength(engineFragment);
  return {
    fragment,
    report: {
      profile: profile.name,
      engine,
      removedElements: [...engineRemovedElements, ...enforced.removedElements],
      removedAttributes: [...engineRemovedAttributes, ...enforced.removedAttributes],
      rewrittenUrls: enforced.rewrittenUrls,
      durationMs: nowMs() - start,
      inputLength: html.length,
      outputLength: length,
      truncated: options.truncated ?? false,
    },
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export { SafeFragmentError };
