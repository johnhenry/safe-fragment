import { DROP_SUBTREE_ELEMENTS } from "./dangerous.js";
import type { ProfileDefinition } from "../policy/profile.js";
import { matchCustomElement } from "../policy/profile.js";
import { isProfileDropElement } from "./enforce.js";
import { MATHML_ELEMENTS, SVG_ELEMENTS, XLINK_NAMESPACE } from "../policy/foreign.js";

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
  /** The native engine's attribute allowlist: `allowedAttributes` plus the DOM's case-sensitive foreign spellings (`viewBox`) and the namespaced `xlink:href`. */
  nativeAttributes: Array<string | { name: string; namespace: string | null }>;
  allowCustomElements: boolean;
  /** DOMPurify `tagNameCheck`: which custom-element tags (exact registered names) survive. */
  customElementTagCheck: (tag: string) => boolean;
  /** Tags the profile drops with their subtree in `enforceProfile` (`dropElements`); DOMPurify must not unwrap them first or their text would leak. */
  profileDropElementCheck: (tag: string) => boolean;
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

  // Opt-in foreign content (ADR 0010): DOMPurify compares lowercased names, the native engine compares the DOM's
  // case-sensitive ones, so both spellings are listed there. enforceProfile validates every value either way.
  const nativeExtra = new Set<string>();
  let xlink = false;
  for (const [enabled, table] of [
    [profile.svg === "static", SVG_ELEMENTS],
    [profile.mathml === "presentation", MATHML_ELEMENTS],
  ] as const) {
    if (!enabled) continue;
    for (const [tag, attrMap] of Object.entries(table)) {
      allowedElements.add(tag.toLowerCase());
      for (const name of Object.keys(attrMap)) {
        if (name === "xlink:href") {
          xlink = true;
          allowedAttributes.add("xlink:href");
          continue;
        }
        allowedAttributes.add(name.toLowerCase());
        nativeExtra.add(name);
      }
    }
  }

  return {
    nativeAttributes: [...new Set([...allowedAttributes, ...nativeExtra]), ...(xlink ? [{ name: "href", namespace: XLINK_NAMESPACE }] : [])],
    // `svg` and `math` are on the shared drop list; the native engine's removeElements matches them in the foreign
    // namespace too, so an opted-in profile must take them off the engine's list (enforceProfile then decides).
    dropSubtreeElements: DROP_SUBTREE_ELEMENTS.filter((tag) => !(tag === "svg" && profile.svg) && !(tag === "math" && profile.mathml)),
    allowedElements: [...allowedElements],
    allowedAttributes: [...allowedAttributes],
    allowCustomElements: profile.customElements.length > 0,
    customElementTagCheck: (tag: string) => matchCustomElement(profile, tag) !== undefined,
    profileDropElementCheck: (tag: string) => isProfileDropElement(profile, tag),
  };
}
