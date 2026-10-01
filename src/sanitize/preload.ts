import type { SanitizerEngineKind } from "../types.js";
import { SafeFragmentError } from "../errors.js";
import { getGlobalDocument } from "../platform/environment.js";
import { hasNativeSanitizer } from "./capabilities.js";
import { getDOMPurify, setDOMPurifyLoader, type DOMPurifyLoader } from "./dompurify.js";

export interface PreloadSanitizerOptions {
  /** The document whose window the sanitizer is prepared for. Defaults to the ambient `document`. */
  document?: Document;
  /** Supplies DOMPurify for pages with no bundler/import map. Also becomes the app-wide loader. */
  loadDOMPurify?: DOMPurifyLoader;
  /**
   * `"auto"` (default) does nothing when the native Sanitizer API exists
   * (it needs no loading). `"dompurify"` loads and instantiates DOMPurify
   * regardless, so the synchronous API works even if you force the fallback.
   */
  engine?: "auto" | "dompurify";
}

/**
 * Prepares the sanitizer so the synchronous API (`sanitizeToFragmentSync`)
 * works and the first render does not pay the DOMPurify load. Resolves with
 * the engine that will be used. Rejects with `SANITIZER_UNAVAILABLE` (whose
 * message says how to fix it) if DOMPurify is needed but cannot be loaded.
 */
export async function preloadSanitizer(options: PreloadSanitizerOptions = {}): Promise<SanitizerEngineKind> {
  const doc = options.document ?? getGlobalDocument();
  if (!doc) {
    throw new SafeFragmentError(
      "UNSUPPORTED_ENVIRONMENT",
      "preloadSanitizer() requires a DOM environment (document). Pass `document` explicitly or call it from browser code.",
    );
  }
  if (options.loadDOMPurify) setDOMPurifyLoader(options.loadDOMPurify);
  if ((options.engine ?? "auto") === "auto" && hasNativeSanitizer(doc)) return "native";
  const win = doc.defaultView;
  if (!win) {
    throw new SafeFragmentError("SANITIZER_UNAVAILABLE", "DOMPurify fallback requires a Document with a defaultView (Window); none is available.");
  }
  await getDOMPurify(win, options.loadDOMPurify);
  return "dompurify";
}
