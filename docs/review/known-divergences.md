# Known divergences

Where two engines, or an engine and the spec of the profile, are not byte-for-byte the same, and why that is acceptable. An unexplained
difference is a bug, never an entry here. The same list is what `test/fuzz/divergences.ts` and the `knownDivergence` field of
`test/fixtures/xss-corpus.ts` encode.

Browsers and engines: Chromium and Firefox have `Element.setHTML` (the native engine); Safari does not (DOMPurify). Both engines parse in standards
mode, in `<body>`/`<div>` context, in an inert document, and their output goes through the same `enforceProfile` and rebuild.

## Fixed (found by the fuzzer, no longer divergences)

| What differed                                                                                                                                                      | Fix                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Quirks mode vs standards mode: `<p><table>` nested on DOMPurify, split on native                                                                                   | DOMPurify parses behind a doctype (ADR 0008, F4).                                               |
| `<frameset>` replaced DOMPurify's body, so it threw `SANITIZE_FAILED` while native rendered the rest                                                               | DOMPurify parses behind `<xmp></xmp>`, which clears the "frameset-ok" flag (F3).                |
| Attribute values that close a markup context, native kept, DOMPurify dropped                                                                                       | `enforceProfile` drops them on both (F1).                                                       |
| `lang="javascript:..."` and other script-scheme values in non-URL attributes                                                                                       | `enforceProfile` drops them on both (F2).                                                       |
| Foreign-content parity: unknown/disallowed SVG and MathML elements, text in text-only integration points, HTML-namespace elements named like opted-in foreign tags | Rules in `enforce-foreign.ts` and `enforce.ts` that reproduce DOMPurify's treatment (ADR 0010). |

## Documented, accepted

### D3: DOMPurify over-removes an element in rare shapes

`SAFE_FOR_XML` removes an element whose text contains `<x` when its serialization also contains markup-looking text, for example an in-element comment
(`<pre>a </ >&lt;b&gt;</pre>`). The native engine keeps the element. DOMPurify only ever removes, so this is fail-safe. The fuzzer tolerates it only when the
input has a comment-like token and DOMPurify's text is a subsequence of native's.

### D4: `<use>` exists only where DOMPurify is the engine

The native Sanitizer API removes `<use>` (and what is inside it) unconditionally; its built-in baseline lists it whatever the config says (Chromium measured;
Firefox runs the same equivalence suite in CI). DOMPurify keeps a same-fragment `<use>`. Under `svg: "static"` this means `use` works in Safari and not in Chromium.
Safe, not equal; documented in ADR 0010 and `docs/profiles.md`. The SVG corpus and the fuzzer compare the engines with `use` removed from both.

### Firefox: `<noscript>` and the scripting flag

Firefox's native `setHTML` parses with the scripting flag **enabled**, so `<noscript>` content is raw text that ends at the first `</noscript>` (which can sit
inside an attribute value), and the tail is parsed as markup; DOMPurify's `DOMParser` document parses with scripting **disabled**, so `noscript` holds elements and
its whole subtree is dropped. Both outputs pass the forbidden-substring check and full enforcement. Recorded as a `knownDivergence` on one XSS fixture
(`browsers: ["firefox"]`), visible in the test title. The new F1 rule also drops the attribute value that closes the `noscript` on both engines.

### Native report vs DOMPurify report

The native engine reports nothing, and the library will not parse the raw string with a gated sink to find out (ADR 0007), so the native `SanitizationReport` cannot list
the engine's unconditional removals (`<script>`, `<iframe>`, `on*`, `javascript:` URLs). DOMPurify's report does. They agree on benign input (empty) and on everything the
profile removes. Diagnostic only; the output is unaffected.

<a id="chromium-csp-reports"></a>

### Parse realm: an iframe on Chromium (issue #13, ADR 0012)

Chromium's HTML parser checks the page's CSP while parsing, in every document that shares the page's execution context: `style-src-attr` for a `style=""` attribute the
moment the parser creates the element (twelve contexts measured: the live document, `createHTMLDocument`, `new Document()`, a `<template>`'s content document, XHTML and
XML documents, a `DOMParser` document, a shadow root, `Document.parseHTML`, `<template>.setHTML`, `ShadowRoot.setHTML`, an SVG context element), and `style-src-elem`/`base-uri`
for elements connected to the document being parsed (DOMPurify's `DOMParser` document). Only the initial document of a hidden `about:blank` iframe reports nothing, so on
Chromium (`navigator.userAgentData` defined; `inertRealm: "auto"`) the engines parse there. Firefox and Safari keep the page's own inert document and never reported.
`inertRealm: "document"` restores the old behavior, and `test/integration/csp-violations.test.ts` pins exactly which directives it reports. Not equal across engines in
one respect: Chromium has a hidden iframe in `<html>` after the first sanitization; the others do not.

## Not divergences, but visible

- **Output trees are not always parser-canonical.** Unwrapping can leave `<p><div>x</div></p>`, which a serialize-and-reparse turns into `<p></p><div>x</div><p></p>`. The reparsed
  tree is still conformant (the fuzzer asserts it) and a second round is stable; roughly 1-2% of random inputs show it. It is a nesting difference, not a security one.
- **The fuzzer cannot run Firefox locally**; Firefox gets the CI budget only.
