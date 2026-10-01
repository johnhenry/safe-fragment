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

  // `data-*` names are literal allowlist entries in both engines (neither
  // accepts a wildcard); `ALLOW_DATA_ATTR` / `dataAttributes` stay off.
  for (const name of profile.allowedDataAttributes) allowedAttributes.add(name);

  return {
    allowedElements: [...allowedElements],
    allowedAttributes: [...allowedAttributes],
    allowCustomElements: profile.allowCustomElements,
  };
}
