import type { ProfileDefinition } from "../policy/profile.js";
import { SAFE_DEFAULT_URL_SCHEMES } from "../policy/url.js";

const GLOBAL_ATTRS = Object.freeze(["id", "lang", "dir", "title"]);

/**
 * `email-v1` -- **scaffold, not fully hardened.** Intended for rendering
 * received HTML email bodies: a restrictive subset covering the
 * table-based layout patterns real email HTML relies on, explicitly with
 * no forms, no scripting elements, no embeds/iframes/objects, no custom
 * elements, and no `style` attribute (`<style>` blocks and inline `style=`
 * are both common HTML-email obfuscation/tracking vectors this profile
 * does not attempt to parse safely for v1).
 *
 * Shares `article-v1`'s URL-scheme policy. Does NOT yet special-case
 * `cid:` (inline attachment) URLs, VML (`<v:*>`, Outlook's proprietary
 * markup), or MSO conditional comments -- real-world HTML email frequently
 * uses all three, and none is handled here yet. Treat this profile as a
 * starting point for a future `email-v1`-hardening pass, not a
 * battle-tested one; the adversarial regression corpus in
 * test/security only runs the shared cross-profile cases against it, not
 * an email-specific fixture set. See README "Known limitations".
 */
export const EMAIL_V1: ProfileDefinition = Object.freeze({
  name: "email-v1",
  mode: "html",
  elements: Object.freeze({
    p: GLOBAL_ATTRS,
    br: Object.freeze([]),
    hr: GLOBAL_ATTRS,
    h1: GLOBAL_ATTRS,
    h2: GLOBAL_ATTRS,
    h3: GLOBAL_ATTRS,
    strong: GLOBAL_ATTRS,
    em: GLOBAL_ATTRS,
    b: GLOBAL_ATTRS,
    i: GLOBAL_ATTRS,
    u: GLOBAL_ATTRS,
    span: GLOBAL_ATTRS,
    div: GLOBAL_ATTRS,
    ul: GLOBAL_ATTRS,
    ol: GLOBAL_ATTRS,
    li: GLOBAL_ATTRS,
    a: Object.freeze([...GLOBAL_ATTRS, "href"]),
    img: Object.freeze([...GLOBAL_ATTRS, "src", "alt", "width", "height"]),
    table: Object.freeze([...GLOBAL_ATTRS, "cellpadding", "cellspacing", "border"]),
    tbody: GLOBAL_ATTRS,
    thead: GLOBAL_ATTRS,
    tfoot: GLOBAL_ATTRS,
    tr: GLOBAL_ATTRS,
    td: Object.freeze([...GLOBAL_ATTRS, "colspan", "rowspan", "align", "valign"]),
    th: Object.freeze([...GLOBAL_ATTRS, "colspan", "rowspan", "align", "valign"]),
  }),
  urlAttributes: Object.freeze(["href", "src"]),
  urlSchemes: SAFE_DEFAULT_URL_SCHEMES,
  allowDataAttributes: false,
  allowStyleAttribute: false,
  allowCustomElements: false,
});
