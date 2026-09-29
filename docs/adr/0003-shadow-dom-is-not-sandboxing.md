# ADR 0003: Shadow DOM is not a security boundary

## Status

Accepted.

## Context

`<safe-fragment scope="shadow">` renders sanitized content into an open
`ShadowRoot` instead of the element's light DOM. It would be easy to read
"shadow" and assume this provides some kind of isolation similar to an
`<iframe sandbox>` -- it does not, and this package must never claim or
imply that it does.

## Decision

Shadow DOM in this package is used **only** for style/markup
encapsulation convenience (letting an application avoid its rendered
content leaking into the host page's CSS selectors, or vice versa), never
as a security mechanism. Specifically documented here so the claim can be
pointed to from the README and code comments rather than re-derived every
time someone asks "is `scope=\"shadow\"` safer?":

- **Script execution is identical either way.** Anything that survives
  sanitization and ends up in a shadow tree runs with exactly the same
  privileges, in exactly the same JavaScript realm, with access to
  exactly the same `document`/`window`/cookies/storage as anything in
  light DOM. An open shadow root does not create a new origin, a new
  realm, or a new execution context.
- **Open shadow roots are trivially introspectable.** `element.shadowRoot`
  gives any script on the page full read/write access to shadow content --
  there is no confidentiality boundary. (A `mode: "closed"` shadow root
  hides the reference from casual `.shadowRoot` access, but this is not
  a security feature either: it is well known to be defeatable, and this
  package doesn't offer a `closed` mode at all for `<safe-fragment>`
  precisely to avoid the false impression that it would help.)
- **Event composition crosses the boundary by default.** Composed events
  (like `click`) bubble out of a shadow tree into the light DOM ancestor
  chain, which is exactly how `<safe-fragment>`'s `data-action`/link
  delegation (a single listener on the host element) works identically
  regardless of `scope`. If shadow DOM were a real isolation boundary,
  this would not be possible without an explicit message-passing bridge.
- The actual security boundary in this package is the **sanitization
  pipeline** (ADR 0001, ADR 0002) that runs _before_ anything is inserted
  into either light DOM or a shadow root -- by the time content reaches
  either, it has already been through the same allowlist. `scope` only
  changes _where_ that already-sanitized content is mounted.
- The one place this codebase intentionally uses a **real** isolation
  primitive is `<example-sandbox>`'s sandboxed, `allow-same-origin`-less
  iframe (see docs/architecture.md and ADR 0001's "Consequences") --
  cross-origin iframes without `allow-same-origin` genuinely cannot
  synchronously access the parent's `document`/cookies/storage, which is
  verified directly in `test/integration/example-sandbox.test.ts`. Shadow
  DOM has no equivalent property.

## Consequences

- `scope="shadow"` is documented in the README and docs/architecture.md
  as a styling/encapsulation convenience, with an explicit "Shadow DOM is
  NOT a security boundary" callout, not buried in a footnote.
- No future PR should add a `mode: "closed"` option to `<safe-fragment>`'s
  shadow scope on the theory that it adds safety -- it would not, and
  would only invite the misunderstanding this ADR exists to prevent.
- Any future feature that genuinely needs isolation (running real code,
  as `<example-sandbox>` does) must use a real isolation primitive
  (sandboxed iframe, Worker, separate origin) -- never shadow DOM.
