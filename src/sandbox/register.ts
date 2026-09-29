import { getGlobalDocument, getCustomElementRegistry, getHTMLElementBase } from "../platform/environment.js";
import { createExampleSandboxElementClass } from "./example-sandbox-element.js";
import { SafeFragmentError } from "../errors.js";

export interface RegisterExampleSandboxOptions {
  tagName?: string;
  document?: Document;
  customElementRegistry?: CustomElementRegistry;
  htmlElementBase?: typeof HTMLElement;
}

/**
 * Registers `<example-sandbox>`. Entirely independent of
 * `registerSafeFragment()` -- an application that only needs
 * `<safe-fragment>` never has to pull this in, and vice versa. See
 * src/sandbox/example-sandbox-element.ts for why this component's trust
 * model is fundamentally different (it runs real code on purpose).
 */
export function registerExampleSandbox(options: RegisterExampleSandboxOptions = {}): void {
  const doc = options.document ?? getGlobalDocument();
  const registry = options.customElementRegistry ?? getCustomElementRegistry();
  const HTMLElementBase = options.htmlElementBase ?? getHTMLElementBase();

  if (!doc || !registry || !HTMLElementBase) {
    throw new SafeFragmentError("UNSUPPORTED_ENVIRONMENT", "registerExampleSandbox() requires a DOM environment (document, customElements, HTMLElement).");
  }

  const tagName = options.tagName ?? "example-sandbox";
  if (registry.get(tagName)) return;

  const ElementClass = createExampleSandboxElementClass(HTMLElementBase);
  registry.define(tagName, ElementClass);
}
