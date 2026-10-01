/**
 * A profile is a versioned, immutable allowlist: which elements may appear,
 * which attributes each element may carry, which URL schemes are acceptable
 * in URL-valued attributes, and a handful of structural policies (custom
 * elements, `style` attribute, `data-*`).
 *
 * Profiles are identified by name, and the name carries the version
 * (`"article-v1"`): a future `article-v2` is a distinct, opt-in profile
 * rather than a silent behavior change under an existing name. The numeric
 * `version` field restates it; a name ending in `-v<N>` whose `N` disagrees
 * with `version` is rejected (`PROFILE_MISMATCH`). Built-in profiles are
 * deeply frozen and can never be modified -- derive a new profile instead
 * (`deriveProfile`) and register it (`registerProfile`).
 */
export interface ProfileDefinition {
  /** Stable identifier, e.g. `"article-v1"`. Matches the `profile` attribute value exactly. */
  readonly name: string;
  /** Integer revision of this profile's semantics (>= 1); must agree with a `-v<N>` name suffix. */
  readonly version: number;
  /** `"text"` profiles never parse HTML at all -- input is always rendered as literal text. */
  readonly mode: "text" | "html";
  /**
   * Allowed elements and, per element, the attributes it may carry.
   * Attribute names are lowercase. An element not present here is removed
   * (along with its subtree) during sanitization.
   */
  readonly elements: Readonly<Record<string, readonly string[]>>;
  /**
   * Extra attribute names to treat as URL-valued. Independently of this
   * list, `enforceProfile` ALWAYS checks the well-known URL-valued names
   * (`src`, `href`, `srcset`, `imagesrcset`, `poster`, `action`,
   * `formaction`, `xlink:href`, `background`, `ping`, `cite`, `data`, ...)
   * wherever they survive, including on custom elements, so a profile
   * cannot forget one. `srcset`/`imagesrcset` are checked per candidate.
   */
  readonly urlAttributes: readonly string[];
  /**
   * Schemes allowed in URL-valued attributes. Use the literal strings
   * `"relative"` (no scheme, no authority: a path, query or fragment
   * reference to the same document/origin) and `"https:"` / `"mailto:"` /
   * etc (colon included, matching `URL#protocol`). Protocol-relative
   * (`//host`) and backslash (`\\host`) URLs are NEVER `"relative"`: they
   * are judged by the scheme they inherit from the document's base URL.
   * `registerProfile` refuses `"javascript:"`, `"data:"`, `"vbscript:"`,
   * `"file:"` and `"blob:"`.
   */
  readonly urlSchemes: readonly string[];
  /**
   * The only `data-*` attributes allowed on any allowed element, as full
   * lowercase names (e.g. `"data-action"`). There is deliberately no
   * wildcard: framework handler attributes (`data-hx-on:click`,
   * `data-turbo-*`, `data-bs-*`, Alpine/htmx-style hooks) are code-by-another-name
   * and must never ride through on a blanket `data-*` allowance.
   */
  readonly allowedDataAttributes: readonly string[];
  /** Whether the `style` attribute is allowed at all. Every v1 profile ships `false`; see docs/adr. */
  readonly allowStyleAttribute: boolean;
  /**
   * Custom elements this profile keeps, each with its own attribute list.
   * An entry's `tag` is either an exact hyphenated name (`"my-widget"`) or a
   * prefix pattern ending in `*` (`"ui--*"` matches `ui--button`,
   * `ui--card`, ...). Any hyphenated tag not matched is unwrapped. Empty (the
   * default, and always for built-ins) means custom elements are not allowed.
   */
  readonly customElements: readonly CustomElementAllowlistEntry[];
  /**
   * Reject same-origin RELATIVE urls on attributes that load automatically
   * (`img src`, `srcset`, `poster`, ...). A relative `<img src="/logout">`
   * issues a credentialed same-origin GET the moment the fragment renders:
   * a side-effect/CSRF-by-GET and tracking vector that needs no click.
   * `email-v1` enables this; `article-v1` and `ui-v1` do not (document the
   * risk to your users or derive a profile that sets it).
   */
  readonly blockRelativeAutoLoadUrls: boolean;
  /**
   * Which `class` tokens may survive, for elements whose attribute list names
   * `class`. Each entry is an exact token (`"btn"`) or a prefix ending in a single
   * `*` (`"user-*"`); matching is case-sensitive. Absent or empty (the default, and
   * `ui-v1`'s) means NO class token survives: a class from untrusted markup can
   * match the host page's selectors (`.admin`, `.hidden`), so a profile names the
   * classes its content may use. A lone `*` is refused. ADR 0011, safe-fragment#7.
   */
  readonly allowedClasses?: readonly string[];
  /**
   * Extra element names dropped WITH their subtree when they are not allowed, on
   * top of the shared list (`src/sanitize/dangerous.ts`), identically in both
   * engines and `enforceProfile`. For containers whose text must not be promoted
   * into the document by unwrapping, e.g. email's Office/VML namespaces
   * (`v:shape`, `o:officedocumentsettings`, `xml`). Lowercase; may contain `:`.
   */
  readonly dropElements?: readonly string[];
  /**
   * `"static"` allows a strict subset of SVG (shapes, paths, text, gradients,
   * `use` of a same-fragment `#id`): no `foreignObject`, `script`, `style`,
   * animation, `image`, filters, event attributes or external references. Every
   * URL attribute goes through `checkUrl`, paint/reference values accept only
   * `url(#id)` of this fragment. Opt-in; absent means every SVG element is
   * dropped. ADR 0010, safe-fragment#3.
   */
  readonly svg?: "static";
  /** `"presentation"` allows MathML presentation elements only (no `annotation-xml`, `semantics`, `maction`, `mglyph`, `href`). Opt-in. ADR 0010. */
  readonly mathml?: "presentation";
}

/** True for a valid `allowedClasses` entry: a bare token, or a non-empty token prefix followed by one `*`. */
export function isValidClassEntry(entry: unknown): entry is string {
  if (typeof entry !== "string" || entry === "") return false;
  const star = entry.indexOf("*");
  if (star !== -1 && (star !== entry.length - 1 || entry.length === 1)) return false;
  for (let i = 0; i < entry.length; i++) {
    const c = entry.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c === 0xa0) return false; // no whitespace or control characters in a class token
  }
  return true;
}

/** Whether `token` is permitted by the profile's `allowedClasses`. */
export function isAllowedClassToken(profile: Pick<ProfileDefinition, "allowedClasses">, token: string): boolean {
  const list = profile.allowedClasses;
  if (!list) return false;
  for (const entry of list) {
    if (entry.endsWith("*") ? token.startsWith(entry.slice(0, -1)) : token === entry) return true;
  }
  return false;
}

/** One custom-element allowlist entry of a profile. */
export interface CustomElementAllowlistEntry {
  /** Lowercase hyphenated tag name (`"my-widget"`) or a prefix pattern ending in `*` (`"ui--*"`). */
  tag: string;
  /** Attributes this specific custom element may carry (beyond `data-*`, governed separately). URL-valued ones are still checked against `urlSchemes`. */
  attributes: readonly string[];
}

/**
 * Names that match the custom-element grammar but are reserved by the HTML
 * and SVG/MathML specs and can never be custom elements.
 */
export const RESERVED_CUSTOM_ELEMENT_NAMES: readonly string[] = Object.freeze([
  "annotation-xml",
  "color-profile",
  "font-face",
  "font-face-src",
  "font-face-uri",
  "font-face-format",
  "font-face-name",
  "missing-glyph",
]);

function isAsciiLower(code: number): boolean {
  return code >= 0x61 && code <= 0x7a;
}

/**
 * True for a syntactically valid custom-element name per the HTML spec's
 * PotentialCustomElementName (lowercase ASCII start, a hyphen, no ASCII
 * uppercase, and a conservative character set), excluding reserved names.
 * Character scan, not a regex.
 */
export function isValidCustomElementName(name: string): boolean {
  if (name.length === 0 || !isAsciiLower(name.charCodeAt(0)) || !name.includes("-")) return false;
  if (RESERVED_CUSTOM_ELEMENT_NAMES.includes(name)) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const ok = isAsciiLower(c) || (c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2e || c === 0x5f || c > 0x7f;
    if (!ok) return false;
  }
  return true;
}

/** True for a valid prefix pattern entry: `<valid-prefix-containing-a-hyphen>*`. */
export function isValidCustomElementPattern(tag: string): boolean {
  if (!tag.endsWith("*")) return false;
  const prefix = tag.slice(0, -1);
  if (prefix.includes("*") || !prefix.includes("-")) return false;
  // Validate the prefix as if it were a name by appending a letter.
  return isValidCustomElementName(`${prefix}a`);
}

/** Finds the allowlist entry for a (lowercase) custom-element tag: exact match first, then the longest matching prefix pattern. Reserved names never match. */
export function matchCustomElement(profile: Pick<ProfileDefinition, "customElements">, tag: string): CustomElementAllowlistEntry | undefined {
  if (!isValidCustomElementName(tag)) return undefined;
  let best: CustomElementAllowlistEntry | undefined;
  let bestLength = -1;
  for (const entry of profile.customElements) {
    if (entry.tag === tag) return entry;
    if (entry.tag.endsWith("*")) {
      const prefix = entry.tag.slice(0, -1);
      if (tag.startsWith(prefix) && prefix.length > bestLength) {
        best = entry;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}
