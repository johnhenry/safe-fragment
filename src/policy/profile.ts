/**
 * A profile is a versioned, immutable allowlist: which elements may appear,
 * which attributes each element may carry, which URL schemes are acceptable
 * in URL-valued attributes, and a handful of structural policies (custom
 * elements, `style` attribute, `data-*`).
 *
 * Profiles are identified by name AND baked-in version suffix (e.g.
 * `"article-v1"`) -- the version is part of the name, not a separate field,
 * so that "the app asked for v1 semantics" is unambiguous and a future
 * `article-v2` is a distinct, opt-in profile rather than a silent behavior
 * change under an existing name.
 */
export interface ProfileDefinition {
  /** Stable identifier, e.g. `"article-v1"`. Matches the `profile` attribute value exactly. */
  readonly name: string;
  /** `"text"` profiles never parse HTML at all -- input is always rendered as literal text. */
  readonly mode: "text" | "html";
  /**
   * Allowed elements and, per element, the attributes it may carry.
   * Attribute names are lowercase. An element not present here is removed
   * (along with its subtree) during sanitization.
   */
  readonly elements: Readonly<Record<string, readonly string[]>>;
  /**
   * Attribute names that are treated as URL-valued wherever they appear on
   * an allowed element (checked against `urlSchemes` regardless of which
   * element carries them, e.g. `href`, `src`, `action`, `formaction`,
   * `xlink:href`, `poster`).
   */
  readonly urlAttributes: readonly string[];
  /**
   * Schemes allowed in URL-valued attributes. Use the literal strings
   * `"relative"` (no scheme / path-relative / protocol-relative same-origin
   * URLs) and `"https:"` / `"mailto:"` / etc (colon included, matching
   * `URL#protocol`). Never include `"javascript:"`, `"data:"`,
   * `"vbscript:"`, or `"file:"` in a shipped profile.
   */
  readonly urlSchemes: readonly string[];
  /** Whether `data-*` attributes are allowed on any allowed element (beyond ones explicitly listed). */
  readonly allowDataAttributes: boolean;
  /** Whether the `style` attribute is allowed at all. Every v1 profile ships `false`; see docs/adr. */
  readonly allowStyleAttribute: boolean;
  /**
   * Whether unknown (hyphenated) custom-element tags may appear at all. When
   * true, an application-registered allowlist (via `defineProfile`'s
   * `customElements` option, see src/policy/registry.ts) determines which
   * specific tags/attributes are kept; anything not registered is removed.
   */
  readonly allowCustomElements: boolean;
}

/** Application-registered custom element allowlist entry, added via `defineProfile`. */
export interface CustomElementAllowlistEntry {
  /** Lowercase, hyphenated tag name, e.g. `"my-widget"`. */
  tag: string;
  /** Attributes this specific custom element may carry (beyond `data-*`, governed separately). */
  attributes: readonly string[];
}
