import type { BaselineConfig } from "./config.js";
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
 * entirely into a detached `<template>` so nothing is ever inserted into a
 * live document before it has been through both this engine's own
 * structural stripping AND the shared `enforceProfile` pass -- a detached
 * `template.content` fragment never fetches resources (`<img src>` does
 * not load, so a stray `onerror` handler an engine bug somehow missed
 * still cannot fire before `enforceProfile` removes it).
 *
 * Only called after `hasNativeSanitizer()` has confirmed `setHTML` exists;
 * throws `SANITIZE_FAILED` if the call itself throws (malformed config,
 * engine-internal error), never silently falls through to an unsanitized
 * parse.
 */
export function sanitizeWithNative(doc: Document, html: string, baseline: BaselineConfig): DocumentFragment {
  const template = doc.createElement("template") as unknown as SetHTMLCapableElement;
  const config: NativeSanitizerConfig = {
    elements: baseline.allowedElements,
    attributes: baseline.allowedAttributes,
    comments: false,
    dataAttributes: false,
  };

  try {
    template.setHTML(html, { sanitizer: config });
  } catch (cause) {
    throw new SafeFragmentError("SANITIZE_FAILED", "Native Sanitizer API (setHTML) threw while sanitizing input.", {
      cause,
    });
  }

  const templateEl = template as unknown as HTMLTemplateElement;
  const frag = doc.createDocumentFragment();
  // Per the HTML fragment-parsing algorithm, a <template> context node's
  // result lands in `.content`; defensively also drain `.childNodes` in
  // case of a nonstandard implementation that appended there instead.
  const source: Node = templateEl.content && templateEl.content.childNodes.length > 0 ? templateEl.content : templateEl;
  while (source.firstChild) frag.appendChild(source.firstChild);
  return frag;
}
