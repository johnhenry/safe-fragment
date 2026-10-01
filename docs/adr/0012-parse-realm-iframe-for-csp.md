# ADR 0012: Parse in a hidden `about:blank` iframe realm where the browser's parser checks the page's CSP

## Status

Accepted. Resolves safe-fragment#13 for Chromium (see "Where it does not apply"). Refines [ADR 0007](0007-no-gated-sink-in-the-native-report.md).

## Context

Under a strict `Content-Security-Policy`, parsing hostile input made Chromium report `style-src-attr` (any `style=`, in both engines),
`style-src-elem` (`<style>`) and `base-uri` (`<base>`, DOMPurify engine) violations, each a `securitypolicyviolation` event, a console error and,
with `report-uri`/`report-to`, a CSP report, although the output was clean and nothing was applied. It is the same class as #12 (Trusted Types
sinks) for other directives: noise an application cannot tell from a real violation, attacker-triggerable, and fatal to a test suite that fails
on console errors.

The first hypothesis (the issue's, and mine) was that Chromium checks CSP only for _connected_ trees, so an inert, never-connected document would
be clean. It is half true: `style-src-elem` and `base-uri` are checked when the element is connected to the document being parsed, which the native
engine's unconnected `<div>` never is and DOMPurify's `DOMParser` document always is. But `style-src-attr` is checked the moment the parser creates
the element, in **every document that shares the page's execution context**, connected or not. Measured (Chromium 14x, meta and header CSP): the live
document, `createHTMLDocument`, `new Document()`, a `<template>`'s content document, an XHTML `createDocument`, a `DOMParser` document, an XML
`DOMParser` document, a shadow root, `Document.parseHTML`, `<template>.setHTML`, `ShadowRoot.setHTML`, an SVG-namespace context element: all twelve report
`style-src-attr`. There is no unsafe-sink-free string filter that could remove `style=` before the parser sees it (that is a tokenizer, and this project does
not write one).

One context reports nothing: the initial document of an empty, same-origin, script-created `about:blank` iframe, even when the page's CSP arrives as a
header and includes `frame-src 'none'` (an `about:blank` frame is not a load). Documents made from that iframe's `DOMImplementation` (`createHTMLDocument`) and
a `DOMParser` made from its window are clean as well. A detached iframe's `DOMImplementation` works for the native engine; DOMPurify needs the iframe attached
(its `isSupported` check fails on a detached window).

## Decision

**The engines parse in a parse realm, and the realm is a hidden iframe where it matters** (`src/platform/realm.ts`).

- One hidden (`hidden`, `aria-hidden`, `tabindex=-1`), empty, `src`-less, same-origin `about:blank` iframe per document, appended to `<html>` (so an application that
  clears `<body>` does not remove it; if it is removed anyway it is made again on the next call), marked `data-safe-fragment-realm`. It never runs script and never holds
  content: it is a factory. The native engine creates its inert documents (`createHTMLDocument`, no browsing context) from the iframe's `DOMImplementation`; DOMPurify
  is created on the iframe's window (still one instance per window, so one Trusted Types policy per realm window). Untrusted markup is parsed exactly where it was
  before, into documents with no browsing context; only the document that owns them changed.
- **`inertRealm: "auto"` is the default and uses the iframe only on Chromium-based engines**, the only ones that report. They are recognized by
  `navigator.userAgentData`, which only Chromium defines. Firefox and Safari keep the page's own inert document (no behavior change where there was no problem, and
  Firefox's asynchronous replacement of an iframe's initial document is not something to take on where it buys nothing). `"iframe"` forces it on every engine (with the same
  fallback); `"document"` never adds an iframe. The option is on `sanitizeToFragment`, `sanitizeToFragmentSync`, `preloadSanitizer` and
  `registerSafeFragment`.
- **Everything falls back to the page's own inert document** when an iframe cannot be created or reached (a page under `sandbox` without `allow-same-origin`, no `<html>`
  yet, an exception), and remembers a permanent failure per document. The change can remove noise; it cannot add a failure.

## Consequences

- With the default, sanitizing hostile input produces **zero CSP violations in every engine and profile** (`test/integration/csp-violations.test.ts`: 33 tests,
  inputs with `style=`, `<style>`, `<base>`, `<link>`, `<meta refresh>`, `<img>`, `<script>`, `<iframe>`, `<object>`, forms, SVG and MathML styles; under a policy that
  forbids every source and enforces Trusted Types). With `inertRealm: "document"` the old, irreducible set is pinned instead.
- **Footprint:** one empty hidden iframe in `<html>` per document that sanitizes on Chromium (about a millisecond, created on first use). It is visible to
  `querySelectorAll("iframe")`, `window.frames`, MutationObservers and a broadcast `postMessage`; applications that cannot have that set `inertRealm: "document"` and accept
  the reports. It is documented in the README and docs/security-model.md.
- It does not weaken anything: the realm is same-origin and scriptless; the DOM it hosts is created and enforced exactly as before (`enforceProfile` and the rebuild are
  unchanged and run in the same inert documents); the rebuilt fragment is adopted into the live document by `replaceChildren` as before.
- The `userAgentData` check is a proxy for "the engine whose parser checks CSP while parsing". If another engine starts to report, use `inertRealm: "iframe"` or change
  the proxy; if Chromium stops, `"auto"` costs an iframe for nothing. Both are one-line changes in `getInertRealm`.
- The fuzzer runs with `auto` by default and `--realm document` for the other path.

## Where it does not apply

A page whose own policy blocks or sandboxes the iframe (`sandbox` without `allow-same-origin`) keeps the reports. Firefox and Safari were never affected in
testing (the Firefox CI run is the check for the former). The hidden iframe is a new DOM-visible artifact: the reviewer packet asks whether that trade is right.
