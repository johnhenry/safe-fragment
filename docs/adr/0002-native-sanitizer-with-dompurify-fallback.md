# ADR 0002: Native Sanitizer API with a DOMPurify fallback, plus a shared authoritative allowlist pass

## Status

Accepted. See [ADR 0004](0004-disallowed-elements-unwrap-or-drop.md) for the later decision on what happens to a disallowed element's content.

## Context

Two credible approaches exist for turning an HTML string into a safe DOM
subtree:

1. The browser-native [HTML Sanitizer API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API)
   (`Element.prototype.setHTML`), which is spec-defined and, where
   available, maintained by the browser vendor as part of the platform.
   Support is not universal yet.
2. [DOMPurify](https://github.com/cure53/DOMPurify), a mature,
   extensively fuzz-tested, widely-deployed sanitization library with a
   long track record specifically around mutation-XSS (mXSS) defenses --
   the class of bug where a sanitizer's output looks safe until the
   browser's _own_ re-parsing/serialization behavior mutates it into
   something dangerous.

Neither is perfect alone: the native API's coverage depends on the
browser; DOMPurify is a third-party dependency with its own bug surface
and, critically, ships a fairly permissive **default** allowlist unless
explicitly configured otherwise.

## Decision

- **Feature-detect** the native Sanitizer API at render time
  (`src/sanitize/capabilities.ts`'s `hasNativeSanitizer()`), never at
  module load time. Prefer it when available.
- **Fall back to DOMPurify** when the native API is unavailable
  (`src/sanitize/dompurify.ts`), imported dynamically (not as a static
  top-level import) so that importing this package in Node/SSR never
  triggers DOMPurify's own module-init path.
- **Never use DOMPurify's out-of-the-box defaults.** `ALLOWED_TAGS` and
  `ALLOWED_ATTR` are always passed explicitly, derived from the active
  profile (`src/sanitize/config.ts`'s `buildBaselineConfig`) -- DOMPurify's
  large general-purpose default allowlist is never what actually gates
  output.
- **Neither engine's own allowlist is the final word.** After either
  engine runs, `src/sanitize/enforce.ts`'s `enforceProfile()` -- a
  hand-written pass that walks the resulting DOM tree via
  `querySelectorAll`/`TreeWalker` and real attribute APIs, with **no
  regex against HTML or attribute strings anywhere** -- re-derives the
  exact allowed element/attribute/URL-scheme set from the profile and
  strips anything that doesn't match. This is the actual security
  boundary; the engines are a first pass that leans on their own
  independent, well-tested parsing/mXSS defenses. `test/security/`'s
  adversarial corpus asserts both engines converge on equivalent output
  through this shared pass.
- URL-scheme filtering specifically is implemented with the platform
  `URL` parser (`src/policy/url.ts`), not `ALLOWED_URI_REGEXP` or any
  other regex-based scheme check -- see that file's doc comment for the
  reasoning (regex-based scheme filters are a recurring bypass vector;
  the URL parser normalizes obfuscated schemes for free).

### A real bug this design caught

Early in this package's development, `enforceProfile` was designed to be
authoritative and DOMPurify's own `KEEP_CONTENT` flag was set to `false`
on the assumption that "authoritative allowlist enforcement happens
afterward anyway, so let DOMPurify be maximally conservative." In
DOMPurify, `KEEP_CONTENT: false` also controls whether `"#text"` is
implicitly added to `ALLOWED_TAGS` -- with an explicit custom
`ALLOWED_TAGS` list and `KEEP_CONTENT: false`, DOMPurify silently
stripped **every text node**, not just the content of disallowed
elements, producing empty tags (`<p></p>`) instead of `<p>hello</p>`. This
was caught by the cross-engine equivalence test in
`test/security/xss-corpus.test.ts` (which asserts the native and
DOMPurify paths produce byte-identical output for a clean fixture) before
it ever shipped. `KEEP_CONTENT: true` is now used instead -- ordinary
text always survives, and `enforceProfile` remains the authoritative
allowlist for which _elements_ survive regardless. This incident is the
concrete argument for ADR 0002's two-layer design: relying on either
engine's configuration flags alone, without a shared, independently
tested enforcement pass, is fragile in exactly this way.

## Consequences

- `dompurify` is a real, declared npm dependency (never vendored) --
  see the README "Family" section.
- Sanitization is inherently async when the DOMPurify path is taken
  (dynamic `import()`); `sanitize()`'s public signature is `Promise`-based
  for both engines, so callers don't need to branch on which engine ran.
- Cross-engine behavioral drift is a real, ongoing risk given these are
  two independently-maintained implementations; the shared `enforceProfile`
  pass and the equivalence test are the mitigations, not a guarantee that
  every possible input produces byte-identical output between engines
  (only that the _security-relevant_ allowlist outcome is the same).
