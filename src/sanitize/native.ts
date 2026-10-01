import type { BaselineConfig } from "./config.js";
import type { SanitizationNote } from "../types.js";
import { SafeFragmentError } from "../errors.js";

/**
 * The current (spec-aligned) SanitizerConfig key names. The pre-2024
 * draft names (`allowComments`, `allowCustomElements`, `allowUnknownMarkup`)
 * are silently ignored by current Chromium, so a config using them looks
 * strict while enforcing nothing -- do not use them.
 */
interface NativeSanitizerConfig {
  elements?: string[];
  removeElements?: string[];
  replaceWithChildrenElements?: string[];
  attributes?: Array<string | { name: string; namespace: string | null }>;
  comments?: boolean;
  dataAttributes?: boolean;
}

interface SetHTMLCapableElement extends Element {
  setHTML(input: string, options?: { sanitizer?: NativeSanitizerConfig }): void;
}

/**
 * Parses `html` via the native `Element.setHTML` (HTML Sanitizer API),
 * entirely inside an INERT document (`DOMImplementation#createHTMLDocument`
 * has no browsing context, so nothing fetches and nothing runs) rather than
 * the live one, so no `<img src>` starts loading before `enforceProfile`
 * has run. The parse context is a `<div>` so fragment parsing behaves like
 * DOMPurify's `<body>` context (a `<template>` context would let stray
 * `<td>`/`<tr>` survive in one engine and not the other).
 *
 * Config shape (ADR 0004): a *blocklist* for elements (`removeElements`:
 * the raw-text/foreign/embedding containers whose subtree must go) and an
 * allowlist for attributes. Unknown or merely-not-allowed elements are left
 * for `enforceProfile`, which unwraps them -- the native default of
 * dropping the whole subtree of any unlisted element would diverge from
 * DOMPurify's `KEEP_CONTENT` behavior.
 *
 * Only called after `hasNativeSanitizer()` has confirmed `setHTML` exists;
 * throws `SANITIZE_FAILED` if the call itself throws (malformed config,
 * engine-internal error), never silently falls through to an unsanitized
 * parse.
 */
export interface NativeOutput {
  fragment: DocumentFragment;
  /** Elements/attributes present in the input but gone before `enforceProfile` ran (the native engine's own removals). */
  removedElements: SanitizationNote[];
  removedAttributes: SanitizationNote[];
}

const MAX_ENGINE_NOTES = 1000;

interface Inventory {
  elements: Map<string, number>;
  attributes: Map<string, number>;
}

function inventoryOf(root: ParentNode): Inventory {
  const elements = new Map<string, number>();
  const attributes = new Map<string, number>();
  for (const el of root.querySelectorAll("*")) {
    const tag = el.localName;
    elements.set(tag, (elements.get(tag) ?? 0) + 1);
    for (const attr of el.attributes) {
      const key = `${tag}\u0000${attr.name.toLowerCase()}`;
      attributes.set(key, (attributes.get(key) ?? 0) + 1);
    }
  }
  return { elements, attributes };
}

/**
 * The native engine reports nothing about what it removed. To keep the
 * `SanitizationReport` honest, parse the same input a second time with a
 * permissive blocklist-only `setHTML` config in the same INERT document (no
 * browsing context: nothing loads or runs) and diff the element/attribute
 * inventories against the engine's output. That reveals everything OUR
 * config removed. It cannot reveal the engine's own unconditional baseline
 * (`<script>`, `on*` handlers): every safe `setHTML` strips those whatever
 * the config says, and the only way to see them is `DOMParser`/`innerHTML`
 * on the raw string, which is a Trusted Types sink -- under
 * `require-trusted-types-for 'script'` that is a blocked action, a
 * `securitypolicyviolation` and a CSP report on EVERY sanitization (#12).
 * There is no way to detect enforcement without triggering it, so no gated
 * sink is ever used, anywhere (ADR 0007, safe-fragment#8).
 */
function parseInputInventory(html: string, inert: Document): Inventory | undefined {
  try {
    const probe = inert.createElement("div") as unknown as SetHTMLCapableElement;
    probe.setHTML(html, { sanitizer: { removeElements: [] } as NativeSanitizerConfig });
    return inventoryOf(probe);
  } catch {
    return undefined;
  }
}

function diffInventories(input: Inventory | undefined, output: Inventory): { elements: SanitizationNote[]; attributes: SanitizationNote[] } {
  const elements: SanitizationNote[] = [];
  const attributes: SanitizationNote[] = [];
  if (!input) return { elements, attributes };
  for (const [tag, n] of input.elements) {
    const missing = n - (output.elements.get(tag) ?? 0);
    for (let i = 0; i < missing && elements.length < MAX_ENGINE_NOTES; i++) elements.push({ tag, reason: "removed-by-engine:native" });
  }
  for (const [key, n] of input.attributes) {
    // An attribute of an element that itself went is not a removed attribute
    // (DOMPurify never reports it either): skip any tag that lost an element.
    const tagName = key.slice(0, key.indexOf("\u0000"));
    if ((output.elements.get(tagName) ?? 0) < (input.elements.get(tagName) ?? 0)) continue;
    const missing = n - (output.attributes.get(key) ?? 0);
    const [tag, attribute] = key.split("\u0000") as [string, string];
    for (let i = 0; i < missing && attributes.length < MAX_ENGINE_NOTES; i++) attributes.push({ tag, attribute, reason: "removed-by-engine:native" });
  }
  return { elements, attributes };
}

export function sanitizeWithNative(doc: Document, html: string, baseline: BaselineConfig): NativeOutput {
  const inert = doc.implementation.createHTMLDocument("");
  const container = inert.createElement("div") as unknown as SetHTMLCapableElement;
  const config: NativeSanitizerConfig = {
    // foreignObject is camelCase in the DOM and the engine matches case-sensitively; enforceProfile drops it either way.
    removeElements: [...baseline.dropSubtreeElements, "foreignObject", "animateTransform", "animateMotion"],
    attributes: baseline.nativeAttributes,
    comments: false,
    dataAttributes: false,
  };

  try {
    container.setHTML(html, { sanitizer: config });
  } catch (cause) {
    throw new SafeFragmentError("SANITIZE_FAILED", "Native Sanitizer API (setHTML) threw while sanitizing input.", {
      cause,
    });
  }

  const frag = inert.createDocumentFragment();
  while (container.firstChild) frag.appendChild(container.firstChild);

  const removed = diffInventories(parseInputInventory(html, inert), inventoryOf(frag));
  return { fragment: frag, removedElements: removed.elements, removedAttributes: removed.attributes };
}
