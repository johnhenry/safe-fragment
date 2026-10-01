# Profiles

A profile is a versioned, immutable allowlist -- which elements may
appear, which attributes each element may carry, which URL schemes are
acceptable, and a handful of structural policies. The version is part of
the name (`article-v1`) and restated in the numeric `version` field: a
future `article-v2` would be a distinct, opt-in profile, never a silent
behavior change under an existing name. A name whose `-v<N>` suffix
disagrees with `version` is rejected with `PROFILE_MISMATCH`.

The five built-in profiles are deeply frozen. Nothing can modify them;
you derive a new profile instead (see
[Custom profiles](#custom-profiles)).

Full source: `src/profiles/*.ts` and `src/policy/profile.ts` (the shape).

## `plain-text-v1`

**Status: fully implemented and tested.**

No HTML parsing at all -- input is always rendered via `textContent`. Use
this whenever content genuinely never needs markup (usernames, plain-text
comments, log lines). Zero attack surface: no HTML parser ever runs on the
input, by construction (`src/sanitize/index.ts` special-cases
`mode: "text"` before either sanitization engine is even considered).

## `article-v1`

**Status: fully implemented and tested** (the primary target of the
adversarial XSS corpus).

Rich, read-mostly text content: paragraphs, headings, lists, tables,
links, images, inline formatting (`strong`/`em`/`code`/etc), blockquotes,
`<time>`. No `class` or `style` (see
[ADR -- style/class exclusion rationale](#why-no-class-or-style)), no
forms, no scripting elements, no custom elements, no SVG/MathML. URL-valued
attributes (`href`, `src`, `cite`) accept only `https:`, `mailto:`, and
relative URLs. `target` survives only as `_blank` (any other value is
dropped) and a kept target always gets `rel="noopener noreferrer"`
forced, overwriting whatever `rel` the markup carried.

**Risk to know about:** relative URLs are allowed on `img src`, so
`<img src="/logout">` makes the browser issue a credentialed same-origin
GET the moment the content renders (safe-fragment#6). If that matters,
derive a profile with `blockRelativeAutoLoadUrls: true` (what `email-v1`
does by default).

## `ui-v1`

**Status: fully implemented and tested**, with a smaller, more conservative
element set than `article-v1` by design.

Structural/interactive application UI: layout containers (`div`, `section`,
`nav`, ...), `button`s and `label`s. Custom elements are not allowed as
shipped (the profile is immutable); to allow some, derive a profile:

```ts
import { registerProfile, deriveProfile } from "@johnhenry/safe-fragment";

registerProfile(
  deriveProfile("ui-v1", {
    name: "my-ui-v1",
    customElements: [
      { tag: "my-widget", attributes: ["role", "tone"] },
      { tag: "ui--*", attributes: ["role"] }, // prefix pattern: ui--card, ui--stat, ...
    ],
    allowedDataAttributes: ["data-action", "data-id"],
  }),
);
```

Then use `profile="my-ui-v1"`. Any hyphenated tag not matched by an entry is
**unwrapped** (its text and allowed descendants stay; see
[ADR 0004](adr/0004-disallowed-elements-unwrap-or-drop.md)). The only
`data-*` attribute `ui-v1` allows is `data-action`: there is no wildcard,
because framework handler attributes like `data-hx-on:click` are code by
another name. `<button>`s are always forced to `type="button"` (so
`submit`/`reset` never survive). `data-action` is read by
`<safe-fragment>`'s click delegation and dispatched as a
`safe-fragment:action` event, letting markup _request_ behavior without
ever supplying code. **`class` is allowlisted and `ui-v1` allows no classes**:
a `class` token survives only if the profile's `allowedClasses` names it (see
[Class allowlist](#class-allowlist), [ADR 0011](adr/0011-class-allowlist.md)).
Same relative-URL risk as `article-v1` (#6).

Deliberately excludes forms (`<form>`, `<input>`, `<select>`,
`<textarea>`, `<button type="submit">`) and SVG/MathML entirely for v1 --
both are real, well-documented sanitizer-bypass surfaces (`formaction`
hijacking; `<svg onload>`/`xlink:href` `javascript:` abuse) that add a lot
of allowlist surface for a use case ("clickable region dispatches an app
action") that doesn't need them.

## `component-template-v1`

**Status: fully implemented and tested.**

The markup of a web component's template, what you are about to clone into a
shadow root. It is `ui-v1` (same elements and attributes, same URL schemes,
`data-action`, forced `type="button"`, ids namespaced by default) plus
shadow-DOM composition:

- `<slot>` with `name`;
- `part`, `slot` and `exportparts` on every allowed element.

Nothing else differs. In particular, still removed (each by design):

| Input                                                                  | Result                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<style>`                                                              | Dropped with its content. Not supported ([ADR 0006](adr/0006-style-element-is-a-non-goal.md)): keep stylesheets outside the sanitized template (below). |
| `style="..."`, `srcset`, `data-*` other than `data-action`             | Removed.                                                                                                                                                |
| `<form>`, `<input>`, `<select>`, `<textarea>`                          | Unwrapped. Form-associated components: the control must come from your own code, or derive a profile and accept the surface.                            |
| SVG, MathML                                                            | Dropped, unless you derive a profile with `svg: "static"` / `mathml: "presentation"` ([below](#svg-and-mathml-opt-in)).                                 |
| `http:` links, including `//host` when the page is served over `http:` | Removed: schemes are `https:`, `mailto:` and relative. Correct, but surprising on a local `http:` dev page.                                             |
| `id` and every reference to it                                         | Rewritten to `user-content-<id>` unless you opt in to `idPolicy: "keep-in-shadow"` (below).                                                             |

Custom elements are not part of the built-in (it is immutable and the prefix is
yours to choose). The recipe:

```ts
import { registerProfile, deriveProfile, COMPONENT_TEMPLATE_V1 } from "@johnhenry/safe-fragment";

registerProfile(
  deriveProfile(COMPONENT_TEMPLATE_V1, {
    name: "my-app-template-v1",
    customElements: [
      // list part/slot/exportparts yourself: a custom element's attributes are exactly what you say
      { tag: "my-app-*", attributes: ["part", "slot", "exportparts", "class", "id", "variant"] },
    ],
  }),
);
```

### Ids inside a shadow root

By default every `id` becomes `user-content-<id>` and every reference to it
(`for`, `aria-controls`, `aria-labelledby`, `aria-describedby`, `aria-owns`,
`href="#x"`, ...) is rewritten with it. A component whose own script or
stylesheet uses `#id` (or `form-control="#id"`) stops matching. That rewrite
exists to stop DOM clobbering of `window`/`document`, which cannot happen to
content inside a shadow root, so there is an opt-in:

```ts
// the caller guarantees the fragment goes into a shadow root
const { fragment } = await sanitizeToFragment(html, { profile: "component-template-v1", idPolicy: "keep-in-shadow" });
shadowRoot.append(fragment);
```

```html
<safe-fragment profile="component-template-v1" scope="shadow" id-policy="keep-in-shadow"></safe-fragment>
```

`<safe-fragment>` enforces the precondition: `id-policy="keep-in-shadow"` with
`scope="light"` rejects with `INVALID_OPTION`. `sanitizeToFragment` cannot, so
the guarantee is yours: inserted into light DOM or the document, a kept id can
clobber `window`/`document` properties. Everything else is still enforced.
See [ADR 0005](adr/0005-component-templates-and-id-policy.md) for the residual
risk.

### Styles

`<style>` is a non-goal ([ADR 0006](adr/0006-style-element-is-a-non-goal.md)).
Author component CSS outside the sanitized markup, as trusted code:

```ts
const sheet = new CSSStyleSheet();
sheet.replaceSync(componentCss); // application-authored, not from the template
shadowRoot.adoptedStyleSheets = [sheet];
shadowRoot.append(fragment);
```

## `email-v1`

**Status: implemented, with an email corpus (benign and hostile) run through
both engines; not yet independently reviewed** ([ADR 0009](adr/0009-email-v1.md),
safe-fragment#2).

Received HTML email bodies. Table-based layout survives; the three things real
mail does that used to be unhandled are handled:

- **`cid:` images.** `cid:` is an allowlisted scheme on `img src` and `background`
  only. The library never fetches it. Pass a resolver and it is replaced by the URL
  the resolver returns; without one the attribute is removed.

  ```ts
  const { fragment } = await sanitizeToFragment(html, {
    profile: "email-v1",
    resolveCid: (contentId) => attachmentUrls.get(contentId), // e.g. a blob: URL you made from the MIME part
  });
  // or for the element: registerSafeFragment({ resolveCid })
  ```

  The answer is validated again before it is written: only `https:`, `blob:` and
  raster `data:image/{png,jpeg,gif,webp,avif,bmp}` URLs pass (never SVG, never
  `javascript:`, `http:`, protocol-relative or relative); anything else, a throw, or a
  non-string removes the attribute. The content-id is attacker-chosen, so the resolver
  should look it up, not concatenate it.

- **MSO conditional comments and VML.** `<!--[if mso]>...<![endif]-->` is a comment and
  is removed with its content; the downlevel-hidden `<!--[if !mso]><!-->...<!--<![endif]-->`
  keeps the non-Outlook content. VML and Office XML outside comments (`<v:*>`, `<w:*>`,
  `<m:*>`, `<xml>`, `<o:OfficeDocumentSettings>`...) are dropped with their text through
  the profile's `dropElements`; `<o:p>` is unwrapped.
- **Layout attributes**, from a fixed list: `width height align valign bgcolor border
cellpadding cellspacing colspan rowspan nowrap summary background` (on the elements
  that take them), `hspace`/`vspace` on `img`, `color face size` on `font`, plus `center`
  and `font`. `background` is a URL attribute: checked like `src`, and `cid:`-resolvable.

Still true: no forms, scripting, embeds, custom elements, `class` or `style`
(`<style>` and inline `style=` are the main way mail is styled, and both are
unsupported, [ADR 0006](adr/0006-style-element-is-a-non-goal.md)). Two visible
consequences: colours and fonts set by CSS are lost, and a "hidden" preheader
(`style="display:none"`) becomes visible text. `blockRelativeAutoLoadUrls: true`: a
relative `img src` is removed. Remote `https:` images **do** load (a tracking pixel is
how the format works); derive a profile with `urlSchemes: ["relative", "mailto:", "cid:"]`
to refuse remote loads.

## Why no `style`, and `class` as an allowlist

`style` is excluded from every profile outright -- inline CSS can smuggle
`url(javascript:...)`-style payloads (neutralized here regardless, since
the attribute is removed unconditionally rather than content-inspected)
and, more subtly, CSS itself can be used for exfiltration and UI-redress
attacks that have nothing to do with `javascript:` URLs at all. Rather than
try to build a safe CSS-property/value allowlist, this package simply doesn't
allow the attribute (and `<style>`, ADR 0006).

`class` is different: it is allowed, but only the tokens a profile names.

### Class allowlist

A class token from untrusted markup can match the host page's own selectors
(`.hidden`, `.admin-banner`, `.modal-backdrop`), which is UI redress with no
script and works under any CSP. `ProfileDefinition.allowedClasses` lists the
tokens content may use: exact (`"btn"`) or prefix (`"user-*"`, one trailing
`*`, never a bare `*`), case-sensitive. A token that matches nothing is removed
(`class-not-allowlisted`); an attribute with nothing left is removed. **`ui-v1`
and `component-template-v1` ship with an empty list, so they allow no classes**;
`article-v1` and `email-v1` do not list `class` at all.

```ts
registerProfile(deriveProfile("ui-v1", { name: "my-ui-v1", allowedClasses: ["user-*", "btn"] }));
```

Why an allowlist and not prefixing, and what it does not cover: [ADR 0011](adr/0011-class-allowlist.md).

## SVG and MathML (opt-in)

Every SVG and MathML element is dropped unless the profile opts in. No built-in does;
derive one:

```ts
registerProfile(deriveProfile("article-v1", { name: "my-article-v1", svg: "static", mathml: "presentation" }));
```

- **`svg: "static"`** is a picture: `svg g defs symbol use path rect circle ellipse line
polyline polygon text tspan textPath title desc linearGradient radialGradient stop
clipPath`, each with its own attribute list (geometry, presentation attributes such as
  `fill`, `stroke`, `transform`, `viewBox`). No `foreignObject`, `script`, `style`,
  animation (`animate`, `set`, ...), `image`, `a`, filters, masks, patterns, markers,
  `switch`, event attributes or `style`. A `fill`/`stroke`/`clip-path` value is a plain
  colour, `rgb()`/`hsl()`, or `url(#id)` of this fragment; `href`/`xlink:href` must be
  `#id` of this fragment (and pass `checkUrl`); path data, transforms and font families
  have their own character grammars. Anything that does not fit removes the attribute.
- **`mathml: "presentation"`** is `math mrow mi mn mo ms mtext mspace mfrac msqrt mroot msub
msup msubsup munder mover munderover mtable mtr mtd mpadded mphantom menclose mstyle` with
  their presentation attributes: no `annotation`, `annotation-xml`, `semantics`, `maction`,
  `mglyph`, no `href`.
- `title`, `desc` and the MathML token elements hold text only. Ids are namespaced
  (`user-content-`) like everywhere, and `url(#id)`/`#id` references are rewritten with them.
- **Not equal on both engines: `<use>`.** The native Sanitizer API removes `<use>`
  unconditionally (Chromium). DOMPurify keeps a same-fragment `use`. So `use` works where
  DOMPurify is the engine (Safari) and is dropped where the native engine runs. Do not rely
  on it across browsers. Everything else gives the same output on both engines (tested).
- Without `style` an SVG with no `fill` attribute renders black; put paint in attributes.

Rationale, the full allowlists and the namespace-confusion corpus:
[ADR 0010](adr/0010-svg-and-mathml-opt-in.md).

## Custom profiles

```ts
import { registerProfile, unregisterProfile, deriveProfile, getProfile, listProfiles } from "@johnhenry/safe-fragment";

const mine = registerProfile({
  name: "comment-v1",
  version: 1,
  mode: "html",
  elements: { p: [], em: [], a: ["href", "title"] },
  urlAttributes: [],
  urlSchemes: ["relative", "https:"],
  allowedDataAttributes: [],
  allowStyleAttribute: false,
  customElements: [],
  blockRelativeAutoLoadUrls: false,
});
```

- `registerProfile(definition)` validates and stores a deeply frozen copy and
  returns it. Invalid input throws a `SafeFragmentError` (`INVALID_PROFILE`,
  or `PROFILE_MISMATCH` for a name/version disagreement), never a raw
  `TypeError`. It refuses: dangerous elements (`script`, `style`, `template`,
  `iframe`, `object`, `embed`, `svg`, `math`, `base`, `meta`, `link`, ...; SVG and
  MathML come in through the `svg`/`mathml` options, not as elements),
  `on*`/`style`/`formaction`/`srcdoc`/`action`/`xlink:href` attributes,
  `javascript:`/`data:`/`vbscript:`/`file:`/`blob:` schemes,
  `allowStyleAttribute: true`, wildcard `data-*` names, custom-element tags
  without a hyphen or with reserved names (`font-face`, `annotation-xml`,
  `color-profile`, `missing-glyph`, ...), and any name that is already
  registered (built-ins included).
- `unregisterProfile(name)` removes a profile you registered (returns whether
  it existed); built-ins cannot be unregistered.
- `deriveProfile(base, overrides)` builds, without registering or mutating,
  a new definition from an existing profile. This is how you add custom
  elements, `data-*` names or a scheme to a built-in.
- Also validated: `allowedClasses` (tokens or `prefix*`), `dropElements` (extra
  elements dropped with their subtree: exact names or `prefix*`), `svg` (`"static"`)
  and `mathml` (`"presentation"`). `deriveProfile` takes the same overrides (`svg: null`
  turns a base's option off).
- Custom-element entries are exact tags or prefix patterns ending in `*`
  (`ui--*`); exact matches win, then the longest prefix. URL-valued
  attributes on custom elements (`src`, `href`, `srcset`, ...) are checked
  against the profile's `urlSchemes` like any other.
- A registered profile is visible to `<safe-fragment profile="...">`,
  `sanitizeToFragment` and, via a `globalThis`-keyed shared store, to both the
  ESM and CJS builds of this package.
