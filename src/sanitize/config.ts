import { DROP_SUBTREE_ELEMENTS } from "./dangerous.js";
import type { ProfileDefinition } from "../policy/profile.js";
import { matchCustomElement } from "../policy/profile.js";

/**
 * Builds a baseline structural allowlist (element + attribute names only --
 * no URL-scheme or `data-*`/`rel`-forcing logic, which the shared
 * `enforceProfile` pass in src/sanitize/enforce.ts handles identically for
 * both engines afterward). Both the native Sanitizer API config and the
 * DOMPurify config are derived from this same shape, so a profile change
 * updates both engines' first-pass behavior consistently.
 *
 * This first pass exists to lean on each engine's own, independently
 * audited HTML-parsing and mutation-XSS defenses (DOMPurify's multi-pass
 * re-parse/re-check; the browser's own native Sanitizer implementation) --
 * it does not need to be pixel-perfect against the profile, because
 * `enforceProfile` is the actual, authoritative allowlist boundary that
 * runs afterward on the resulting DOM tree either way.
 */
export interface BaselineConfig {
  /** Raw-text/foreign/embedding containers dropped with their subtree when not allowed (see ./dangerous.ts, ADR 0004). */
  dropSubtreeElements: string[];
  allowedElements: string[];
  allowedAttributes: string[];
  allowCustomElements: boolean;
  /** DOMPurify `tagNameCheck`: which custom-element tags (exact registered names) survive. */
  customElementTagCheck: (tag: string) => boolean;
}

export function buildBaselineConfig(profile: ProfileDefinition): BaselineConfig {
  const allowedElements = new Set<string>(Object.keys(profile.elements));
  const allowedAttributes = new Set<string>();

  for (const attrs of Object.values(profile.elements)) {
    for (const attr of attrs) allowedAttributes.add(attr);
  }

  // Exact custom-element tags join the element list; prefix patterns
  // (`ui--*`) cannot be enumerated, so they are matched by the DOMPurify
  // tagNameCheck below (the native engine runs in blocklist mode and does
  // not need them). Their attribute names join the attribute allowlist.
  for (const entry of profile.customElements) {
    if (!entry.tag.endsWith("*")) allowedElements.add(entry.tag);
    for (const attr of entry.attributes) allowedAttributes.add(attr);
  }

  // `data-*` names are literal allowlist entries in both engines (neither
  // accepts a wildcard); `ALLOW_DATA_ATTR` / `dataAttributes` stay off.
  for (const name of profile.allowedDataAttributes) allowedAttributes.add(name);

  return {
    dropSubtreeElements: [...new Set([...DROP_SUBTREE_ELEMENTS, ...(profile.dropElements ?? [])])],
    allowedElements: [...allowedElements],
    allowedAttributes: [...allowedAttributes],
    allowCustomElements: profile.customElements.length > 0,
    customElementTagCheck: (tag: string) => matchCustomElement(profile, tag) !== undefined,
  };
}
