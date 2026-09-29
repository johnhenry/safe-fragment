# ADR 0001: HTML is data, never code

## Status

Accepted.

## Context

The most common way HTML-rendering libraries introduce XSS is by treating
an untrusted string as if it were trusted markup at the moment it touches
the DOM: `element.innerHTML = untrustedString`,
`element.outerHTML = untrustedString`,
`element.insertAdjacentHTML(pos, untrustedString)`, or the newer
`element.setHTMLUnsafe(untrustedString)`. Every one of these APIs parses
the string and inserts the resulting nodes into a **live** document with
**no** allowlist applied -- `<script>` tags won't execute (browsers
suppress that specific case), but `<img onerror>`, `<svg onload>`, event
handler attributes, `javascript:`/`data:` URLs, and dozens of other
sinks all fire normally. "We'll sanitize the string first, then assign it"
is exactly the pattern that has produced the long history of
sanitizer-bypass CVEs across the ecosystem, because the sanitizing step and
the assignment step are two separate operations an application can get out
of order, forget, or apply inconsistently across call sites.

## Decision

`@johnhenry/safe-fragment` treats every input string as **data to be
parsed and filtered through an explicit allowlist**, never as markup to be
trusted. Concretely:

- The unsafe sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `setHTMLUnsafe`, and any equivalent) are **never called on untrusted
  input**, anywhere in this codebase. This is enforced by design (the
  sanitization pipeline in `src/sanitize/` is the only path from a string
  to DOM nodes) and spot-checked by the adversarial regression corpus in
  `test/security/`.
- Parsing and sanitization always happen together, as one pipeline
  (`src/sanitize/index.ts`'s `sanitize()`), producing an **inert, detached
  `DocumentFragment`** that has already been through the profile's
  allowlist before anything is ever inserted into a live document.
- The only way markup becomes visible DOM is through `<safe-fragment>`'s
  `render()` pipeline (or a direct call to `sanitize()` for advanced use),
  which always calls one of the two sanitization engines (native Sanitizer
  API or DOMPurify -- see ADR 0002) followed by the shared, authoritative
  `enforceProfile()` allowlist pass (`src/sanitize/enforce.ts`).
- There is deliberately **no** "trusted"/"unsafe"/"allowScripts" escape
  hatch anywhere in the public API. An application that genuinely needs a
  fully-trusted fast path (e.g. server-rendered markup it wrote itself)
  should just assign that markup directly with the platform's own APIs in
  its own code -- that is an _application-level_ decision with
  application-level trust boundaries, not something this library should
  make easy to reach for by accident on untrusted input.

## Consequences

- Every profile is a closed allowlist (elements, attributes, URL schemes).
  Anything not explicitly listed is removed, not "escaped" or left for a
  developer to remember to check later.
- `plain-text-v1` takes this to its logical extreme: it never invokes an
  HTML parser on its input at all (`textContent` only), because the
  smallest possible attack surface is not running a parser in the first
  place.
- `<example-sandbox>` (see docs/architecture.md and
  src/sandbox/example-sandbox-element.ts) is a deliberately **separate**
  component precisely because it does the opposite of this ADR on
  purpose -- it exists specifically to run real, application-authored
  code inside an isolated iframe. It must never be confused with
  `<safe-fragment>` or implied to share its trust model.
