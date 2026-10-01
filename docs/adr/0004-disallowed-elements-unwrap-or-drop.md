# ADR 0004: One behavior for disallowed elements -- drop dangerous containers, unwrap everything else

## Status

Accepted. Refines [ADR 0002](0002-native-sanitizer-with-dompurify-fallback.md).

## Context

An element that is not in the active profile has to go. What happens to its
_content_ differed between the two engines:

- The native Sanitizer API drops the whole subtree of an element missing
  from `elements` (unless it is listed in `replaceWithChildrenElements`).
- DOMPurify with `KEEP_CONTENT: true` unwraps it (children are hoisted)
  except for its built-in `FORBID_CONTENTS` set, and it additionally
  force-removes some elements outright (any element carrying `is=`).
- `enforceProfile` removed the subtree.

So `<p>a <marquee>b <em>c</em></marquee></p>` rendered `a b c` on one engine
and `a ` on the other, and the old "equivalence test" compared a single
hand-picked string, so nobody noticed. A security boundary whose output
depends on which browser you are in cannot be reviewed once.

## Decision

Both engines and `enforceProfile` implement ONE rule:

1. **Dangerous or raw-text containers drop their whole subtree.** The list
   lives in `src/sanitize/dangerous.ts`: `script`, `style`, `template`,
   `noscript`, `iframe`, `noembed`, `noframes`, `xmp`, `textarea`, `title`,
   `select`, `object`, `embed`, `svg`, `math`, plus `plaintext`, `applet`,
   `frame`, `frameset`, `head`. Their content is either not markup (raw
   text/RCDATA, where "unwrapping" would promote attacker-chosen source
   text into the document) or lives in a different parsing mode, or is an
   embedding surface. Any element outside the HTML namespace is dropped
   with its subtree whatever its tag name.
2. **Every other non-allowed element is unwrapped**: the element goes, its
   text and (separately enforced) allowed descendants stay. This covers
   unknown elements, presentational ones (`marquee`, `font`, `center`, `u`
   when not allowed), table cells in profiles without tables, and
   unregistered custom elements.

Implementation:

- **DOMPurify:** `KEEP_CONTENT: true` (still required -- see the incident in
  ADR 0002) plus `FORBID_CONTENTS` _replaced_ (not extended) by our list, and
  `FORCE_BODY: true` so a leading `<noscript>`/`<title>` is parsed in
  `<body>` like the native engine's context. A `beforeSanitizeAttributes`
  hook drops `is=` instead of letting DOMPurify force-remove the element.
- **Native:** `removeElements` is set to the drop list; the native default
  of dropping unlisted elements is not used because it cannot express
  "unwrap unknown elements" (the unknown set cannot be enumerated for
  `replaceWithChildrenElements`). Not-allowed elements are left alone and
  unwrapped by `enforceProfile`. Parsing happens in a `<div>` of an inert
  document (`createHTMLDocument`), body context, no loads.
- **`enforceProfile`:** the authoritative implementation of rules 1 and 2;
  runs identically after either engine.
- **`rebuildFragment`:** after enforcement the fragment is rebuilt from
  fresh elements, so hidden node state (a customized built-in's `is` value,
  which survives attribute removal and is re-emitted by the serializer)
  cannot reach the document.

The native config uses the current spec key names (`removeElements`,
`attributes`, `comments`, `dataAttributes`); the pre-2024 names
(`allowComments`, `allowCustomElements`, `allowUnknownMarkup`) are silently
ignored by Chromium and must not be used.

## Consequences

- `test/security/engine-equivalence.test.ts` runs the whole XSS corpus plus
  the benign corpus through both engines and compares a normalized DOM
  (attribute-order-insensitive). Where a browser has no native engine
  (WebKit today) it is skipped with the reason in the test title.
- `test/security/benign-corpus.test.ts` and the `survives` fields of the XSS
  corpus assert that benign content is still there. A sanitizer that deletes
  everything passes every "forbidden substring" assertion.
- Reported reasons changed: `element-unwrapped:not-in-profile`,
  `element-unwrapped:custom-element-not-registered`,
  `element-dropped:dangerous-container`, `element-dropped:foreign-namespace`.
- Unwrapping is the more author-friendly behavior and matches the DOMPurify
  default. The cost is that a disallowed element's text now appears; for
  dangerous containers (the only place hostile text could hide) it does not.
