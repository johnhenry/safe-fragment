import type { ProfileDefinition, CustomElementAllowlistEntry } from "../policy/profile.js";
import type { SanitizationReport } from "../types.js";
import { SafeFragmentError } from "../errors.js";
import { hasNativeSanitizer } from "./capabilities.js";
import { buildBaselineConfig } from "./config.js";
import { sanitizeWithNative } from "./native.js";
import { sanitizeWithDOMPurify } from "./dompurify.js";
import { enforceProfile } from "./enforce.js";

export interface SanitizeOptions {
  /** Force a specific engine, bypassing feature detection. Test-only; not exposed on the public custom-element API. */
  forceEngine?: "native" | "dompurify";
  /** True if the input was truncated upstream (e.g. by the `src` fetch size cap) before reaching the sanitizer. */
  truncated?: boolean;
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
export async function sanitize(
  doc: Document,
  html: string,
  profile: ProfileDefinition,
  customElements: ReadonlyMap<string, CustomElementAllowlistEntry>,
  options: SanitizeOptions = {},
): Promise<SanitizeResult> {
  const start = nowMs();

  if (profile.mode === "text") {
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

  const baseline = buildBaselineConfig(profile, customElements);
  const useNative = options.forceEngine === "native" || (options.forceEngine === undefined && hasNativeSanitizer(doc));

  let fragment: DocumentFragment;
  let engine: "native" | "dompurify";

  if (useNative) {
    fragment = sanitizeWithNative(doc, html, baseline);
    engine = "native";
  } else {
    fragment = await sanitizeWithDOMPurify(doc, html, baseline, profile.allowDataAttributes);
    engine = "dompurify";
  }

  const { removedElements, removedAttributes, rewrittenUrls } = enforceProfile(fragment, profile, customElements, { baseUrl: doc.baseURI });

  const outputLength = serializedLength(fragment);

  return {
    fragment,
    report: {
      profile: profile.name,
      engine,
      removedElements,
      removedAttributes,
      rewrittenUrls,
      durationMs: nowMs() - start,
      inputLength: html.length,
      outputLength,
      truncated: options.truncated ?? false,
    },
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function serializedLength(fragment: DocumentFragment): number {
  const doc = fragment.ownerDocument;
  const container = doc.createElement("div");
  container.appendChild(fragment.cloneNode(true));
  return container.innerHTML.length;
}

export { SafeFragmentError };
