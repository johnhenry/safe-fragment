/**
 * All access to browser globals goes through these functions -- called
 * lazily, from inside `registerSafeFragment()`/`registerExampleSandbox()`
 * or other function bodies, never evaluated at module top level. This is
 * what keeps `import "@johnhenry/safe-fragment"` safe in Node/SSR: nothing
 * here runs until an application explicitly calls a register function in
 * an environment that actually has a DOM.
 */

export function getGlobalDocument(): Document | undefined {
  return typeof document === "undefined" ? undefined : document;
}

export function getCustomElementRegistry(): CustomElementRegistry | undefined {
  return typeof customElements === "undefined" ? undefined : customElements;
}

export function getHTMLElementBase(): typeof HTMLElement | undefined {
  return typeof HTMLElement === "undefined" ? undefined : HTMLElement;
}

export function isDomAvailable(): boolean {
  return getGlobalDocument() !== undefined && getCustomElementRegistry() !== undefined && getHTMLElementBase() !== undefined;
}
