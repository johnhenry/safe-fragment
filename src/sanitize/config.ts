import type { ProfileDefinition, CustomElementAllowlistEntry } from "../policy/profile.js";

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
  allowedElements: string[];
  allowedAttributes: string[];
  allowCustomElements: boolean;
}

export function buildBaselineConfig(profile: ProfileDefinition, customElements: ReadonlyMap<string, CustomElementAllowlistEntry>): BaselineConfig {
  const allowedElements = new Set<string>(Object.keys(profile.elements));
  const allowedAttributes = new Set<string>();

  for (const attrs of Object.values(profile.elements)) {
    for (const attr of attrs) allowedAttributes.add(attr);
  }

  if (profile.allowCustomElements) {
    for (const entry of customElements.values()) {
      allowedElements.add(entry.tag);
      for (const attr of entry.attributes) allowedAttributes.add(attr);
    }
  }

  if (profile.allowDataAttributes) {
    // Neither the Sanitizer API's `allowAttributes` list nor DOMPurify's
    // ALLOWED_ATTR accepts a wildcard pattern like "data-*" -- both want
    // literal attribute names. `enforceProfile` is what actually allows
    // arbitrary `data-*` names (via a real `startsWith("data-")` check on
    // the live attribute, not a config string), so this first pass simply
    // does not try to enumerate them; anything dropped here that
    // `enforceProfile` would have kept is a false negative in the engine's
    // OWN pass only, not in the final output.
  }

  return {
    allowedElements: [...allowedElements],
    allowedAttributes: [...allowedAttributes],
    allowCustomElements: profile.allowCustomElements,
  };
}
