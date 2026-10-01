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
export function sanitizeWithNative(doc: Document, html: string, baseline: BaselineConfig): DocumentFragment {
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
  return frag;
}
