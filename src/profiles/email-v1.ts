import type { ProfileDefinition } from "../policy/profile.js";
import { SAFE_DEFAULT_URL_SCHEMES } from "../policy/url.js";

// `role` and two aria attributes are what accessible layout tables use (`role="presentation"`).
const GLOBAL_ATTRS = Object.freeze(["id", "lang", "dir", "title", "role", "aria-label", "aria-hidden"]);
const ALIGN = Object.freeze([...GLOBAL_ATTRS, "align"]);
// Presentational HTML attributes of table layout, the markup real email is built from.
// None is a URL except `background`, which goes through checkUrl (and `cid:`) like `src`.
// Their values are parsed by the legacy HTML attribute algorithms (a colour, a length), never as CSS,
// and `style` stays unavailable.
const CELL = Object.freeze([...GLOBAL_ATTRS, "align", "valign", "bgcolor", "width", "height", "background"]);
const SECTION = Object.freeze([...GLOBAL_ATTRS, "align", "valign", "bgcolor"]);

/**
 * `email-v1` -- received HTML email bodies (ADR 0009, safe-fragment#2).
 *
 * - **Table layout.** A restrictive subset of what table-based mail uses: tables and
 *   their sections/cells with the presentational attributes (`width`, `height`, `align`,
 *   `valign`, `bgcolor`, `border`, `cellpadding`, `cellspacing`, `colspan`, `rowspan`,
 *   `nowrap`, `background`), `center`, `font` (`color`, `face`, `size`), images with
 *   `align`/`hspace`/`vspace`/`border`. No forms, scripting, embeds, custom elements,
 *   `class` or `style`: inline `style=` and `<style>` are how mail does its styling, and
 *   both are unsupported (ADR 0006), so expect layout and fonts but not colours-by-CSS.
 * - **`cid:` images.** `cid:` is an allowlisted scheme on `img src` and `background`
 *   only. The library never fetches it: it is passed to the caller's `resolveCid` and
 *   replaced by the URL that returns (`https:`, `blob:` or a raster `data:` URL, checked),
 *   or the attribute is removed.
 * - **MSO conditional comments** (`<!--[if mso]>...<![endif]-->`) are comments and go
 *   with every other comment, content included; the downlevel-hidden form
 *   (`<!--[if !mso]><!-->...<!--<![endif]-->`) keeps the content for non-Outlook readers.
 * - **VML and Office XML** (`<v:*>`, `<o:*>`, `<w:*>`, `<m:*>`, `<xml>`) outside comments are
 *   dropped with their text, in both engines; `<o:p>` (a Word paragraph marker around
 *   `&nbsp;`) is unwrapped.
 * - Remote `https:` images load: that is a tracking pixel by design of the format. Derive
 *   a profile with `urlSchemes: ["relative", "mailto:", "cid:"]` to refuse remote loads.
 *
 * Shares `article-v1`'s other URL rules; relative auto-loading URLs are refused.
 */
export const EMAIL_V1_PROFILE: ProfileDefinition = Object.freeze({
  name: "email-v1",
  version: 1,
  mode: "html",
  elements: Object.freeze({
    p: ALIGN,
    br: Object.freeze([]),
    hr: Object.freeze([...GLOBAL_ATTRS, "align", "width", "size", "noshade"]),
    h1: ALIGN,
    h2: ALIGN,
    h3: ALIGN,
    h4: ALIGN,
    h5: ALIGN,
    h6: ALIGN,
    strong: GLOBAL_ATTRS,
    em: GLOBAL_ATTRS,
    b: GLOBAL_ATTRS,
    i: GLOBAL_ATTRS,
    u: GLOBAL_ATTRS,
    s: GLOBAL_ATTRS,
    small: GLOBAL_ATTRS,
    sub: GLOBAL_ATTRS,
    sup: GLOBAL_ATTRS,
    code: GLOBAL_ATTRS,
    pre: GLOBAL_ATTRS,
    abbr: GLOBAL_ATTRS,
    cite: GLOBAL_ATTRS,
    address: GLOBAL_ATTRS,
    span: GLOBAL_ATTRS,
    div: ALIGN,
    center: GLOBAL_ATTRS,
    font: Object.freeze([...GLOBAL_ATTRS, "color", "face", "size"]),
    blockquote: GLOBAL_ATTRS,
    ul: GLOBAL_ATTRS,
    ol: Object.freeze([...GLOBAL_ATTRS, "start", "type"]),
    li: GLOBAL_ATTRS,
    dl: GLOBAL_ATTRS,
    dt: GLOBAL_ATTRS,
    dd: GLOBAL_ATTRS,
    a: Object.freeze([...GLOBAL_ATTRS, "href"]),
    img: Object.freeze([...GLOBAL_ATTRS, "src", "alt", "width", "height", "border", "align", "hspace", "vspace"]),
    table: Object.freeze([...GLOBAL_ATTRS, "width", "height", "align", "bgcolor", "border", "cellpadding", "cellspacing", "background", "summary"]),
    caption: ALIGN,
    colgroup: Object.freeze([...GLOBAL_ATTRS, "span", "width", "align", "valign"]),
    col: Object.freeze([...GLOBAL_ATTRS, "span", "width", "align", "valign"]),
    tbody: SECTION,
    thead: SECTION,
    tfoot: SECTION,
    tr: SECTION,
    td: Object.freeze([...CELL, "colspan", "rowspan", "nowrap", "headers"]),
    th: Object.freeze([...CELL, "colspan", "rowspan", "nowrap", "headers", "scope"]),
  }),
  urlAttributes: Object.freeze(["href", "src", "background"]),
  urlSchemes: Object.freeze([...SAFE_DEFAULT_URL_SCHEMES, "cid:"]),
  allowedDataAttributes: Object.freeze([]),
  allowStyleAttribute: false,
  customElements: Object.freeze([]),
  blockRelativeAutoLoadUrls: true,
  allowedClasses: Object.freeze([]),
  // Office/VML namespaces outside comments: drop with their text (a VML button's fallback label, the
  // `<xml><o:OfficeDocumentSettings>` block). `<o:p>` is deliberately not here: it wraps `&nbsp;`, unwrapping is right.
  dropElements: Object.freeze([
    "xml",
    "v:*",
    "w:*",
    "m:*",
    "o:allowpng",
    "o:pixelsperinch",
    "o:officedocumentsettings",
    "o:shapedefaults",
    "o:shapelayout",
    "o:idmap",
    "o:lock",
    "o:extrusion",
    "o:colormru",
    "o:colormenu",
  ]),
});
