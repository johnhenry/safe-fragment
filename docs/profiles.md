# Profiles

A profile is a versioned, immutable allowlist -- which elements may
appear, which attributes each element may carry, which URL schemes are
acceptable, and a handful of structural policies. The version is baked
into the name (`article-v1`, not `article` with a separate version field):
a future `article-v2` would be a distinct, opt-in profile, never a silent
behavior change under an existing name.

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
relative URLs. `target="_blank"` anchors always get
`rel="noopener noreferrer"` forced.

## `ui-v1`

**Status: fully implemented and tested**, with a smaller, more conservative
element set than `article-v1` by design.

Structural/interactive application UI: layout containers (`div`, `section`,
`nav`, ...), buttons, labels, plus whatever custom elements an application
explicitly registers via:

```ts
import { defineProfile } from "@johnhenry/safe-fragment";

defineProfile("ui-v1", {
  customElements: [{ tag: "my-widget", attributes: ["role", "data-state"] }],
});
```

Any custom element tag not registered this way is removed entirely
(subtree included) -- see docs/security-model.md's `enforceProfile`
walkthrough. `data-*` attributes are allowed on any allowed element
(`allowDataAttributes: true`); `data-action` specifically is read by
`<safe-fragment>`'s click delegation and dispatched as a
`safe-fragment:action` event, letting markup _request_ behavior without
ever supplying code.

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
`article-v1`'s URL-scheme policy. Does **not** yet special-case `cid:`
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

## Adding an application-specific profile

There is currently no public `registerProfile()` for adding an entirely
new named profile (only `defineProfile()` for extending `ui-v1`'s custom-
element allowlist) -- see the README's "Known limitations." An application
that needs a genuinely different allowlist today should compose against
`src/policy/profile.ts`'s `ProfileDefinition` shape and call
`sanitize()`/`enforceProfile()` directly rather than going through
`<safe-fragment>`'s `profile` attribute, which only resolves against the
registry.
