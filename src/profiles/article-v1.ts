import type { ProfileDefinition } from "../policy/profile.js";
import { SAFE_DEFAULT_URL_SCHEMES } from "../policy/url.js";

const GLOBAL_ATTRS = Object.freeze(["id", "lang", "dir", "title"]);

/**
 * `article-v1` -- rich, read-mostly text content: prose, headings, lists,
 * tables, links, images. No `class`/`style` (see docs/adr for why -- CSS
 * targeting the host page's own selectors is a real phishing/clickjacking
 * vector even without JS execution), no forms, no scripting elements, no
 * custom elements. URL-valued attributes accept only `https:`, `mailto:`,
 * and relative URLs -- `javascript:`, `data:`, `vbscript:`, `file:` are
 * always rejected regardless of markup.
 */
export const ARTICLE_V1_PROFILE: ProfileDefinition = Object.freeze({
  name: "article-v1",
  version: 1,
  mode: "html",
  elements: Object.freeze({
    p: GLOBAL_ATTRS,
    br: Object.freeze([]),
    hr: GLOBAL_ATTRS,
    h1: GLOBAL_ATTRS,
    h2: GLOBAL_ATTRS,
    h3: GLOBAL_ATTRS,
    h4: GLOBAL_ATTRS,
    h5: GLOBAL_ATTRS,
    h6: GLOBAL_ATTRS,
    strong: GLOBAL_ATTRS,
    em: GLOBAL_ATTRS,
    b: GLOBAL_ATTRS,
    i: GLOBAL_ATTRS,
    u: GLOBAL_ATTRS,
    s: GLOBAL_ATTRS,
    small: GLOBAL_ATTRS,
    sub: GLOBAL_ATTRS,
    sup: GLOBAL_ATTRS,
    mark: GLOBAL_ATTRS,
    code: GLOBAL_ATTRS,
    pre: GLOBAL_ATTRS,
    kbd: GLOBAL_ATTRS,
    samp: GLOBAL_ATTRS,
    var: GLOBAL_ATTRS,
    abbr: GLOBAL_ATTRS,
    cite: GLOBAL_ATTRS,
    wbr: Object.freeze([]),
    span: GLOBAL_ATTRS,
    div: GLOBAL_ATTRS,
    blockquote: Object.freeze([...GLOBAL_ATTRS, "cite"]),
    q: Object.freeze([...GLOBAL_ATTRS, "cite"]),
    time: Object.freeze([...GLOBAL_ATTRS, "datetime"]),
    ul: GLOBAL_ATTRS,
    ol: Object.freeze([...GLOBAL_ATTRS, "start", "reversed", "type"]),
    li: Object.freeze([...GLOBAL_ATTRS, "value"]),
    dl: GLOBAL_ATTRS,
    dt: GLOBAL_ATTRS,
    dd: GLOBAL_ATTRS,
    a: Object.freeze([...GLOBAL_ATTRS, "href", "target", "rel"]),
    img: Object.freeze([...GLOBAL_ATTRS, "src", "alt", "width", "height", "loading", "decoding"]),
    figure: GLOBAL_ATTRS,
    figcaption: GLOBAL_ATTRS,
    table: GLOBAL_ATTRS,
    caption: GLOBAL_ATTRS,
    colgroup: GLOBAL_ATTRS,
    col: Object.freeze([...GLOBAL_ATTRS, "span"]),
    thead: GLOBAL_ATTRS,
    tbody: GLOBAL_ATTRS,
    tfoot: GLOBAL_ATTRS,
    tr: GLOBAL_ATTRS,
    th: Object.freeze([...GLOBAL_ATTRS, "colspan", "rowspan", "scope", "headers"]),
    td: Object.freeze([...GLOBAL_ATTRS, "colspan", "rowspan", "headers"]),
  }),
  urlAttributes: Object.freeze(["href", "src", "cite"]),
  urlSchemes: SAFE_DEFAULT_URL_SCHEMES,
  allowedDataAttributes: Object.freeze([]),
  allowStyleAttribute: false,
  customElements: Object.freeze([]),
  blockRelativeAutoLoadUrls: false,
});
