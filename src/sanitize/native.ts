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
  attributes?: string[];
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
    if (tag === "html" || tag === "head" || tag === "body") continue; // DOMParser's implied wrappers
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
 * `SanitizationReport` honest, parse the same input a second time into an
 * INERT document (no browsing context: nothing loads or runs) and diff the
 * element/attribute inventories against the engine's output. If a
 * `DOMParser` is not usable (e.g. Trusted Types enforced, which gates
 * `parseFromString`), fall back to a second `setHTML` with a permissive
 * blocklist-only config, which still reveals everything OUR config removed
 * (only the engine's unconditional script/handler baseline goes uncounted).
 */
function parseInputInventory(doc: Document, html: string, inert: Document): Inventory | undefined {
  try {
    const win = doc.defaultView as (Window & { DOMParser?: typeof DOMParser }) | null;
    if (win?.DOMParser) return inventoryOf(new win.DOMParser().parseFromString(html, "text/html"));
  } catch {
    // fall through to the setHTML-based inventory
  }
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
    removeElements: baseline.dropSubtreeElements,
    attributes: baseline.allowedAttributes,
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

  const removed = diffInventories(parseInputInventory(doc, html, inert), inventoryOf(frag));
  return { fragment: frag, removedElements: removed.elements, removedAttributes: removed.attributes };
}
