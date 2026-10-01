# Profiles

A profile is a versioned, immutable allowlist -- which elements may
appear, which attributes each element may carry, which URL schemes are
acceptable, and a handful of structural policies. The version is part of
the name (`article-v1`) and restated in the numeric `version` field: a
future `article-v2` would be a distinct, opt-in profile, never a silent
behavior change under an existing name. A name whose `-v<N>` suffix
disagrees with `version` is rejected with `PROFILE_MISMATCH`.

The four built-in profiles are deeply frozen. Nothing can modify them;
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
ever supplying code. `class` is allowed (safe-fragment#7 tracks the
host-selector risk). Same relative-URL risk as `article-v1` (#6).

Deliberately excludes forms (`<form>`, `<input>`, `<select>`,
`<textarea>`, `<button type="submit">`) and SVG/MathML entirely for v1 --
both are real, well-documented sanitizer-bypass surfaces (`formaction`
hijacking; `<svg onload>`/`xlink:href` `javascript:` abuse) that add a lot
of allowlist surface for a use case ("clickable region dispatches an app
action") that doesn't need them.

## `email-v1`

**Status: scaffold, not fully hardened -- see the caveat in
`src/profiles/email-v1.ts` and the README's "Known limitations."**

A restrictive subset covering the table-based layout patterns real HTML
email relies on: no forms, no scripting elements, no
embeds/iframes/objects, no custom elements, no `style`. Shares
`article-v1`'s URL-scheme policy and, unlike it, sets
`blockRelativeAutoLoadUrls: true`: a relative `img src`/`srcset`/`poster`
is removed, because it would otherwise fire a same-origin GET on render.
Tracked in safe-fragment#2. Does **not** yet special-case `cid:`
(inline attachment) URLs, VML (`<v:*>`, Outlook's proprietary markup), or
MSO conditional comments, all of which real-world HTML email commonly
uses. The adversarial regression corpus only runs its shared,
cross-profile fixtures against this profile (via the profile-shape
invariant tests in `test/unit/profiles.test.ts`), not an email-specific
fixture set targeting email-client-specific quirks. Treat this as a
starting point for a future hardening pass, not a battle-tested profile.

## Why no `class` or `style`

`style` is excluded from every v1 profile outright -- inline CSS can smuggle
`url(javascript:...)`-style payloads (neutralized here regardless, since
the attribute is removed unconditionally rather than content-inspected)
and, more subtly, CSS itself can be used for exfiltration and UI-redress
attacks that have nothing to do with `javascript:` URLs at all. Rather than
try to build a safe CSS-property/value allowlist for v1, this package
simply doesn't allow the attribute.

`class` is excluded from `article-v1`/`email-v1` (both read-mostly content
profiles with no legitimate need for it) but allowed in `ui-v1` (where
practical component styling needs it) -- see docs/security-model.md
"What this package does not protect against" for the residual risk this
carries (a `class` value from sanitized markup could coincidentally match
a selector in the host page's own stylesheet).

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
  `iframe`, `object`, `embed`, `svg`, `math`, `base`, `meta`, `link`, ...),
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
- Custom-element entries are exact tags or prefix patterns ending in `*`
  (`ui--*`); exact matches win, then the longest prefix. URL-valued
  attributes on custom elements (`src`, `href`, `srcset`, ...) are checked
  against the profile's `urlSchemes` like any other.
- A registered profile is visible to `<safe-fragment profile="...">`,
  `sanitizeToFragment` and, via a `globalThis`-keyed shared store, to both the
  ESM and CJS builds of this package.
