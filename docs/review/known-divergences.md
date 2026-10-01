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

### Chromium CSP reports while parsing hostile input (issue #13)

Under a strict CSP, Chromium reports `style-src-attr` for a `style=""` attribute the moment its HTML parser creates the element, `style-src-elem` for a `<style>` and
`base-uri` for a `<base>` once the element is connected to the document being parsed. Measured in twelve contexts, all of which report `style-src-attr`:
the live document, `createHTMLDocument`, `new Document()`, a `<template>`'s content document, an XHTML `createDocument`, a `DOMParser` document, an XML `DOMParser` document, a
shadow root, `Document.parseHTML`, `<template>.setHTML`, `ShadowRoot.setHTML`, an SVG-namespace context element. The check is on the element's execution context, not on whether the tree is connected.
`style-src-elem` and `base-uri` are only reported when the element is connected to a document tree: the native engine parses into an unconnected `<div>` and never
reports them; DOMPurify's `DOMParser` document connects them, so the DOMPurify engine on Chromium (only reachable by forcing it) does. WebKit reports nothing.

What is done: the library connects nothing (asserted: no node of any result is connected, and none is owned by the live document), performs one parse per engine plus the
native report's probe, and `test/integration/csp-violations.test.ts` pins that, per engine and profile, **only** the irreducible directives appear and only for
inputs that contain the construct. What cannot be done without a CSP-free realm or a pre-parse string filter (a tokenizer, which this project does not have) is making the
count zero. Hosts that report CSP violations as alerts have no library-side switch: they should filter reports whose `blockedURI` is `inline` and whose document is the page that calls the sanitizer, or accept the noise.

## Not divergences, but visible

- **Output trees are not always parser-canonical.** Unwrapping can leave `<p><div>x</div></p>`, which a serialize-and-reparse turns into `<p></p><div>x</div><p></p>`. The reparsed
  tree is still conformant (the fuzzer asserts it) and a second round is stable; roughly 1-2% of random inputs show it. It is a nesting difference, not a security one.
- **The fuzzer cannot run Firefox locally**; Firefox gets the CI budget only.
