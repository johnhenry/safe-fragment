# ADR 0006: `<style>` is a non-goal; `<style>` stays dropped with its content

## Status

Accepted for 0.0.0. Reopen with an independent review (safe-fragment#1) in hand.
Leaves the `<style>` item of safe-fragment#11 open as a documented non-goal.

## Context

A component template commonly carries its own `<style>`; shadow DOM is what makes
that safe to write. Today a `<style>` is in `DROP_SUBTREE_ELEMENTS` and
`registerProfile` refuses it: it is removed with its content, identically in both
engines. Supporting it means sanitizing CSS, and HTML sanitizers are not CSS
sanitizers.

A CSS sanitizer would have to be CSSOM-based (no regex is allowed in this
project): parse with a constructed `CSSStyleSheet`, walk `cssRules`, allowlist
rule types and properties, then re-serialize. What that has to cover, and what
makes it a different, larger security surface than the rest of this package:

- **Every URL-bearing construct**: `url()`, `image-set()`/`-webkit-image-set()`,
  `src()`, `cross-fade()`, `element()`, `paint()`, `@import`, `@font-face src`,
  `cursor`, `list-style-image`, `mask`, `border-image`, `content`, `filter: url()`,
  `attr()` typed as url, and any future function that fetches. An allowlist of
  properties and of function names is required: a denylist will miss the next one.
  Each URL would go through `checkUrl`.
- **Indirection**: custom properties and `var()` carry tokens (including
  escaped `u\72l(`) whose meaning is decided at computed-value time, so either
  every `--*` and `var()` is banned or the substituted value must be re-validated
  against every property it lands in.
- **Non-URL attacks that need no network**: UI redress (`position: fixed` over the
  host page, `z-index`, `pointer-events`, `opacity: 0` overlays), `:host`/`::slotted`
  and `::part` reaching outside the component, attribute-selector and `:has()`
  probing of host-controlled content for later exfiltration by any allowed URL,
  `@container`/`@scope`/`@layer` side effects, and `@property`/`@keyframes` name
  collisions. These are not removable by URL checks; they need a property allowlist
  and a decision on position/stacking, which is a product decision per component.
- **Parser differentials and a moving target**: CSS grows a new fetching or
  position-affecting feature every year, and a browser's `CSSStyleSheet` parse
  differs from another's. The package would need a corpus per engine and a policy
  for unknown rules, with the same mXSS-style scrutiny HTML gets.

Shipping a CSS sanitizer that is "mostly right" in a package whose entire claim is
that its allowlist is the boundary, before its first independent review, is worse
than shipping none.

## Decision

`<style>` is **out of scope**. There is no profile option, no
`sanitizeStyle()`, no stylesheet string handling. It stays in
`DROP_SUBTREE_ELEMENTS`; `registerProfile` still refuses it; the `style`
attribute is still refused. The README, docs/profiles.md and
docs/security-model.md say so, with the reason.

**What to do instead** (documented):

- Keep component stylesheets **outside** the sanitized template, as trusted,
  application-authored CSS: `shadowRoot.adoptedStyleSheets = [sheet]` with a
  constructed `CSSStyleSheet`, or a `<style>` the component creates itself.
  Sanitize only the markup (`component-template-v1`).
- If the stylesheet comes from a source less trusted than the component, that is
  a trust decision this package does not make for you: vet it with a purpose-built
  CSS tool, or do not accept it.

## Consequences

- html-modules-style loaders keep treating `<html-export><style>` as unsanitized,
  and must treat it as exactly as trusted as the module's script.
- Revisit as a separate, opt-in, CSSOM-based design with its own adversarial
  corpus and an independent review, not as a flag on an existing profile.
