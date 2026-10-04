# ADR 0013: Detach the parse-realm iframe on Chromium; ADR 0012's attached iframe only moved the reports

## Status

Accepted. Corrects [ADR 0012](0012-parse-realm-iframe-for-csp.md) (its decision stands with the change below; its measurement was wrong).

## Context

ADR 0012 parsed in documents made from a hidden, attached, same-origin `about:blank` iframe because "it reports nothing". A strict-CSP demo
(Chromium, `style-src 'self'`, `article-v1`, `<p style="color:red">x</p>`) still logged two `style-src-attr` violations per render. They were
dispatched to the **iframe's** document, not the page's, and that is the whole story:

- An `about:blank` iframe inherits its creator's policy container, so the realm iframe enforces the page's CSP, `report-uri`/`report-to` included.
- Chromium's parser checks `style-src-attr` against the policy of the document's execution context; documents created from the iframe's
  `DOMImplementation` or `DOMParser` belong to the iframe's context. So every violation was still raised (a console error and a CSP report,
  `document-uri: "about"`, the page URL as `referrer`, and up to 40 characters of the attacker's `style` value as `script-sample` when the policy has
  `'report-sample'`); the event just fired on a document nobody listened to.
- `test/integration/csp-violations.test.ts` listened on the page's document only, which is why it measured zero.

Measured again (Chromium 153, Playwright, a header CSP with `report-uri` served by a local endpoint that counts the reports it receives):

| parse realm                      | native engine (`setHTML` + the report's inventory parse) | DOMPurify engine                                              | reports received |
| -------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- | ---------------- |
| page (`inertRealm: "document"`)  | 2 × `style-src-attr` on the page                         | `style-src-attr` (+ `style-src-elem`, `base-uri`) on the page | 1 per violation  |
| attached iframe (ADR 0012)       | 2 × `style-src-attr` on the iframe                       | the same set, on the iframe                                   | 1 per violation  |
| iframe removed after it was made | none                                                     | none                                                          | **0**            |

The violation is raised by the parse itself (the parser setting the attribute), before any sanitizer config applies: `setHTML` with
`attributes: []`, `setHTMLUnsafe`, a `<template>`, `DOMParser`, `Document.parseHTMLUnsafe`/`parseHTML` and a plain `setAttribute("style")` all
report, so it happens whether or not the profile allows `style` (none does). Adopting or inserting the sanitized result into the page reports
nothing (no `style` survives, and adoption is not re-checked). Nothing was ever applied: the inline style is blocked, then removed. WebKit
reported nothing in any context; Firefox was not re-measured locally (it does not launch in this sandbox) and `"auto"` does not use the iframe
there.

Documents whose window has been detached (the iframe removed) have no execution context, so there is no policy to check and nothing to report.
Trusted Types are still enforced on a detached window's `DOMParser` (a string is refused), so this is not a way around ADR 0007.

## Decision

**On Chromium the realm iframe is attached only for as long as it takes to make it, then removed** (`src/platform/realm.ts`).

- `getInertRealm` appends the iframe to `<html>`, captures its window and `DOMImplementation`, runs an optional `prepare(win)` while it is attached,
  and removes it. The native engine needs nothing more: its inert documents come from that detached `DOMImplementation`.
- **DOMPurify needs a live window to be created** (`createDOMPurify(detachedWindow).isSupported` is `false`) and registers its Trusted Types
  policy lazily, on the first `sanitize()`; a detached window can no longer create a policy (`InvalidStateError`), after which DOMPurify fails.
  So `getRealmDOMPurify` creates the instance in `prepare`, and every instance is warmed with one `sanitize("")` at creation so the policy exists
  before the window is detached. If the cached realm is already detached and has no DOMPurify yet, a new realm replaces it (the native engine
  works with either). Still one instance, so one `dompurify` policy, per realm window.
- **Off Chromium, `inertRealm: "iframe"` keeps the attached iframe of ADR 0012.** WebKit's Trusted Types policies stop working once their window is
  detached (`TrustedTypePolicyOptions did not specify a 'createHTML' member`, measured), and neither WebKit nor (per CI) Firefox reports parser
  violations in the first place. `"auto"` never uses the iframe there.
- The fallbacks of ADR 0012 are unchanged: no iframe can be made, the page's own inert document is used.
- **Tests watch every document involved.** `test/helpers/csp.ts` listens on the page and on every iframe inserted into it (by wrapping the
  insertion methods, with a `MutationObserver` that fails the test if an iframe is inserted another way), for both
  `csp-violations.test.ts` and `trusted-types-violations.test.ts`. Against the ADR 0012 code these tests fail; the "orrery" input is a test of its own.

## Consequences

- With the default, sanitizing hostile input on Chromium raises zero violations and sends zero reports, in every document.
- **Footprint shrinks:** nothing stays in the page. An iframe is inserted and removed in the same task, once per document (twice if DOMPurify is
  created after the native engine already made the realm); a `MutationObserver` sees that pair, `querySelectorAll("iframe")` sees nothing. The
  detached window is kept alive for the document's lifetime (a `WeakMap` keyed by the document).
- The `userAgentData` proxy now also decides whether to detach. If a future Chromium starts checking CSP for detached contexts, or WebKit starts
  reporting, the test that watches every document fails rather than going quiet.
- `"document"` is unchanged and still reports the irreducible set pinned in the test.
