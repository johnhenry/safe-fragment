import { getGlobalDocument, getCustomElementRegistry, getHTMLElementBase } from "../platform/environment.js";
import { createSafeFragmentElementClass } from "./safe-fragment-element.js";
import { DEFAULT_FETCH_CAPABILITY, type FetchCapability } from "../source/fetch.js";
import { SafeFragmentError } from "../errors.js";
import { setDOMPurifyLoader, type DOMPurifyLoader } from "../sanitize/dompurify.js";

export interface RegisterSafeFragmentOptions {
  /** Custom element tag name to register under. Defaults to `"safe-fragment"`; override only for naming collisions/testing. */
  tagName?: string;
  /** The `src` remote-fetch capability model. Disabled unless explicitly enabled here. */
  fetch?: Partial<FetchCapability>;
  /**
   * Supplies the DOMPurify factory for the fallback engine, for pages with no
   * bundler or import map (Safari has no native `setHTML`, so this is its
   * default path): `loadDOMPurify: () => import("https://esm.sh/dompurify@3.4.16").then((m) => m.default)`.
   * Without it, the bare specifier `dompurify` must resolve (import map or bundler).
   */
  loadDOMPurify?: DOMPurifyLoader;
  /** Explicit `Document`/`CustomElementRegistry`/`HTMLElement` overrides -- mainly for tests that construct their own realm. Defaults to the ambient globals. */
  document?: Document;
  customElementRegistry?: CustomElementRegistry;
  htmlElementBase?: typeof HTMLElement;
}

/**
 * Registers the `<safe-fragment>` custom element. Must be called
 * explicitly by the consuming application -- importing
 * `@johnhenry/safe-fragment` never does this as an import side effect, so
 * the package stays importable in Node/SSR where no custom element
 * registry exists.
 *
 * Idempotent: calling this more than once for the same tag name is a
 * no-op (not an error), since `CustomElementRegistry#define` throws if
 * called twice for the same name and test suites / hot-reloading
 * frequently need to call this more than once safely.
 */
export function registerSafeFragment(options: RegisterSafeFragmentOptions = {}): void {
  const doc = options.document ?? getGlobalDocument();
  const registry = options.customElementRegistry ?? getCustomElementRegistry();
  const HTMLElementBase = options.htmlElementBase ?? getHTMLElementBase();

  if (!doc || !registry || !HTMLElementBase) {
    throw new SafeFragmentError(
      "UNSUPPORTED_ENVIRONMENT",
      "registerSafeFragment() requires a DOM environment (document, customElements, HTMLElement). " +
        "It was called somewhere that has none -- likely Node/SSR. Only call it from browser-executed code.",
    );
  }

  if (options.loadDOMPurify) setDOMPurifyLoader(options.loadDOMPurify);

  const tagName = options.tagName ?? "safe-fragment";
  if (registry.get(tagName)) return; // idempotent

  const fetchCapability: FetchCapability = {
    ...DEFAULT_FETCH_CAPABILITY,
    ...options.fetch,
    allowedOrigins: options.fetch?.allowedOrigins ?? DEFAULT_FETCH_CAPABILITY.allowedOrigins,
  };

  const ElementClass = createSafeFragmentElementClass(HTMLElementBase, { fetchCapability });
  registry.define(tagName, ElementClass);
}
