import type { ProfileDefinition } from "../policy/profile.js";
import { SAFE_DEFAULT_URL_SCHEMES } from "../policy/url.js";

const GLOBAL_ATTRS = Object.freeze(["id", "lang", "dir", "title", "class"]);
// `data-action` is the event-delegation hook `<safe-fragment>` wires up for
// ui-v1 (see src/render/action-delegation.ts); every other `data-*`
// attribute is allowed too (allowDataAttributes: true below) since
// application UI markup routinely carries its own data attributes for CSS
// hooks/JS state that the *application*, not this library, reads.
const INTERACTIVE_ATTRS = Object.freeze([...GLOBAL_ATTRS, "data-action", "role", "tabindex", "aria-label", "aria-hidden", "aria-expanded", "aria-controls"]);

/**
 * `ui-v1` -- structural/interactive application UI: layout containers,
 * buttons, labels, plus custom elements an application explicitly
 * registers via `defineProfile("ui-v1", { customElements: [...] })`.
 *
 * Deliberately excludes forms (`<form>`, `<input>`, `<select>`,
 * `<textarea>`, `<button type="submit">`) and SVG/MathML entirely for v1 --
 * both are real, well-known sanitizer-bypass surfaces (`formaction`
 * hijacking; `<svg onload>`/`xlink:href` `javascript:` abuse) and neither
 * is needed for the "clickable region dispatches an app action" use case
 * this profile targets. See docs/adr and the "Known limitations" section
 * of the README.
 *
 * `data-action` on any allowed element is read by `<safe-fragment>`'s click
 * delegation and dispatched as a `safe-fragment:action` event -- markup
 * can request behavior, but never supplies code; the application decides
 * what each action string does.
 */
export const UI_V1: ProfileDefinition = Object.freeze({
  name: "ui-v1",
  mode: "html",
  elements: Object.freeze({
    div: INTERACTIVE_ATTRS,
    span: INTERACTIVE_ATTRS,
    section: INTERACTIVE_ATTRS,
    header: INTERACTIVE_ATTRS,
    footer: INTERACTIVE_ATTRS,
    nav: INTERACTIVE_ATTRS,
    main: INTERACTIVE_ATTRS,
    article: INTERACTIVE_ATTRS,
    aside: INTERACTIVE_ATTRS,
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
    small: GLOBAL_ATTRS,
    code: GLOBAL_ATTRS,
    pre: GLOBAL_ATTRS,
    ul: GLOBAL_ATTRS,
    ol: Object.freeze([...GLOBAL_ATTRS, "start", "reversed", "type"]),
    li: Object.freeze([...INTERACTIVE_ATTRS, "value"]),
    a: Object.freeze([...INTERACTIVE_ATTRS, "href", "target", "rel"]),
    img: Object.freeze([...GLOBAL_ATTRS, "src", "alt", "width", "height", "loading", "decoding"]),
    label: Object.freeze([...GLOBAL_ATTRS, "for"]),
    button: Object.freeze([...INTERACTIVE_ATTRS, "type", "disabled"]),
  }),
  urlAttributes: Object.freeze(["href", "src"]),
  urlSchemes: SAFE_DEFAULT_URL_SCHEMES,
  allowDataAttributes: true,
  allowStyleAttribute: false,
  allowCustomElements: true,
  forceRelOnBlankTarget: true,
});
