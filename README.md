# @johnhenry/safe-fragment

[![npm version](https://img.shields.io/npm/v/%40johnhenry%2Fsafe-fragment.svg)](https://www.npmjs.com/package/@johnhenry/safe-fragment)
[![CI](https://github.com/johnhenry/safe-fragment/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/safe-fragment/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/%40johnhenry%2Fsafe-fragment.svg)](LICENSE)

Full documentation: [opensource.johnhenry.me/safe-fragment](https://opensource.johnhenry.me/safe-fragment/)

Framework-agnostic, dependency-light Web Components for rendering
HTML-like source into live DOM **only** after applying an explicit,
versioned security profile -- an allowlist of elements, attributes, and
URL schemes, sanitized through the native
[HTML Sanitizer API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Sanitizer_API)
or a locked-down [DOMPurify](https://github.com/cure53/DOMPurify) fallback.

This is **not** a generic `<inner-html>` wrapper. `<safe-fragment>` never
assigns untrusted strings through `innerHTML`, `outerHTML`,
`insertAdjacentHTML`, `setHTMLUnsafe`, or any equivalent unsafe sink --
see [Security model](#security-model) below.

> **Status: not yet published, not yet independently reviewed.**
> `version` is pinned at `0.0.0`; there is no npm release and no GitHub
> release tag yet. See [Known limitations](#known-limitations) and
> [What still needs human review](#what-still-needs-human-review) before
> using this for anything beyond experimentation. See
> [SECURITY.md](SECURITY.md) for how to report a suspected sanitizer
> bypass.

## Contents

- [Security model](#security-model)
- [Install](#install)
- [Quick start](#quick-start)
- [Try it live](#try-it-live)
- [`<safe-fragment>` API](#safe-fragment-api)
- [Profiles](#profiles)
- [The `src` remote-fetch capability](#the-src-remote-fetch-capability)
- [`<example-sandbox>`](#example-sandbox)
- [Error codes](#error-codes)
- [Known limitations](#known-limitations)
- [What still needs human review](#what-still-needs-human-review)
- [Family](#family)
- [License](#license)

## Security model

**What safe-fragment guarantees:**

- **Untrusted strings never reach an unsafe DOM sink.** `innerHTML`,
  `outerHTML`, `insertAdjacentHTML`, `setHTMLUnsafe` (and equivalents) are
  never called with unsanitized input anywhere in this codebase --
  parsing and allowlist enforcement always happen together, before
  anything touches a live document. See
  [ADR 0001](docs/adr/0001-html-as-data-not-code.md).
- **Every render goes through a closed, versioned allowlist**, not a
  denylist. An element or attribute not explicitly listed in the active
  profile is removed -- dangerous containers with their whole subtree, other
  disallowed elements unwrapped (ADR 0004) -- never "escaped and left in place."
- **URL-scheme filtering uses the platform `URL` parser, never regex.**
  `javascript:`, `data:`, `vbscript:`, and `file:` URLs are rejected
  under every shipped profile, including whitespace/entity/case-obfuscated
  variants -- see `src/policy/url.ts` and the adversarial corpus in
  `test/security/`.
- **Two independent sanitization engines converge on the same allowlist.**
  The native Sanitizer API (when available) or a locked-down DOMPurify
  fallback do the initial parse; a shared, hand-written `enforceProfile()`
  pass then re-derives and enforces the exact allowed set from the
  profile, identically regardless of which engine ran. See
  [ADR 0002](docs/adr/0002-native-sanitizer-with-dompurify-fallback.md).
- **`on*` event-handler attributes are always stripped**, even if a
  profile or an application's custom-element registration mistakenly
  allowlists one -- a hardcoded backstop, not the primary defense.
- **`target="_blank"` anchors always get `rel="noopener noreferrer"`
  forced**, closing the reverse-tabnabbing hole regardless of source
  markup.
- **No "unsafe"/"trusted"/"allowScripts" escape hatch exists anywhere in
  this public API.** There is no flag that turns sanitization off for a
  particular render.
- **Importing this package never touches `window`/`document`/
  `HTMLElement`/`customElements`.** Nothing renders and no custom element
  is defined until an application explicitly calls `registerSafeFragment()`
  from code that actually runs in a browser -- safe to `import` in
  Node/SSR.
- **The `src` remote-fetch source is disabled by default**, GET-only,
  same-origin unless an application explicitly allowlists other origins,
  size-capped, and supersession-safe (an older in-flight fetch can never
  overwrite a newer render's output).

**What is still yours:**

- **Choosing the right profile.** Rendering attacker-controlled content
  under `ui-v1` (which allows `class`, `data-*`, and app-registered custom
  elements) when `article-v1` or `plain-text-v1` would do is a choice this
  library cannot make for you.
- **What your own custom elements do.** `defineProfile("ui-v1", {
customElements: [...] })` lets your registered custom elements receive
  sanitized attribute values; what your custom element's own
  `attributeChangedCallback` (or anything else) does with them is your
  code, not this library's.
- **`<example-sandbox>`'s executable code is never sanitized, and is not
  meant to be.** It is a _separate_ component for running
  application-authored, trusted code samples in an isolated iframe -- see
  [`<example-sandbox>`](#example-sandbox). Feeding it untrusted user input
  is a misuse of the component, not a bypass of `<safe-fragment>`.
- **Shadow DOM (`scope="shadow"`) is a styling convenience, not an
  isolation boundary.** See
  [ADR 0003](docs/adr/0003-shadow-dom-is-not-sandboxing.md) -- do not rely
  on it for anything a real sandbox would need to guarantee.
- **CSS-based and content-level risks this library cannot see.** See
  [docs/security-model.md](docs/security-model.md) "What this package
  does not protect against" for the full list (phishing via a
  syntactically-valid link, `class`-based selector targeting in `ui-v1`,
  parse-time cost of very large strings passed directly to `.html`).

Full detail: [docs/security-model.md](docs/security-model.md).

## Install

```bash
npm install @johnhenry/safe-fragment dompurify
```

`dompurify` is a peer of the sanitization fallback path and is already a
normal `dependencies` entry of this package (npm will install it
automatically) -- listed here for clarity, not because you need to
install it separately.

Requires Node >=26 for the toolchain (build/test); the shipped ESM/CJS
output targets evergreen browsers.

## Quick start

```js
import { registerSafeFragment } from "@johnhenry/safe-fragment";

// Call once, from browser-executed code. Never happens as an import
// side effect.
registerSafeFragment();
```

```html
<safe-fragment profile="article-v1" id="post"></safe-fragment>
<script type="module">
  document.getElementById("post").html = await fetch("/api/posts/42").then((r) => r.text());
</script>
```

Or declaratively, via a `<template>` child (never eagerly parsed as live
markup by the browser -- `<template>` content is inert until explicitly
read):

```html
<safe-fragment profile="article-v1">
  <template>
    <p>Hello <strong>world</strong>. <img src="x" onerror="alert(1)" /></p>
  </template>
</safe-fragment>
<!-- Renders: <p>Hello <strong>world</strong>. <img src="x"></p> -- the
     onerror attribute is gone; nothing executes. -->
```

## Try it live

```sh
npm run build && npx http-server . -p 4995
```

Then open **`examples/playground/`** -- type or paste HTML, or click a real
attack from the test corpus (img `onerror`, `javascript:` links, `svg
onload`, formaction hijacking). One box renders it completely
unprotected (literal `innerHTML` in a sandboxed iframe -- if something
fires, you'll see it happen); the other renders the same input through
`<safe-fragment>`. A second tab demos the `ui-v1` "content requests, host
decides" action protocol with a live application log.

The other three examples (`article-viewer/`, `ui-protocol-demo/`,
`sandbox-playground/`) are smaller, single-scenario versions of the same
ideas, each also exercised directly by
`test/examples/examples-smoke.test.ts`. `npx serve .` also works for any
of them, but needs a `serve.json` with `cleanUrls: false` in the repo root
(already present) -- `serve`'s default URL rewriting otherwise breaks the
examples' relative `./main.mjs` imports.

## `<safe-fragment>` API

### Attributes / properties

| Attribute     | Property      | Notes                                                                                                                                |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `profile`     | `.profile`    | Required. Name of a registered profile (`plain-text-v1`, `article-v1`, `ui-v1`, `email-v1`, or an application-registered one).       |
| --            | `.html`       | Highest-precedence markup source. Setting it schedules a render.                                                                     |
| `src`         | `.source`     | URL to fetch markup from. Disabled by default -- see [below](#the-src-remote-fetch-capability).                                      |
| `content`     | --            | Legacy, lowest-precedence source. Emits a `console.warn` when used.                                                                  |
| `render-mode` | `.renderMode` | `"replace"` (default) \| `"once"` \| `"manual"`.                                                                                     |
| `scope`       | `.scope`      | `"light"` (default) \| `"shadow"`. See [ADR 0003](docs/adr/0003-shadow-dom-is-not-sandboxing.md).                                    |
| `loading`     | `.loading`    | `"eager"` (default) \| `"lazy"` -- defers a `src` fetch until the element intersects the viewport.                                   |
| `disabled`    | `.disabled`   | Clears and suspends rendering.                                                                                                       |
| `strict`      | `.strict`     | When present, more than one simultaneous markup source is an `AMBIGUOUS_SOURCE` rejection instead of silently picking by precedence. |
| `debug`       | `.debug`      | `console.warn`s the code/message of every `reject` event.                                                                            |

**Source precedence** (highest first): `.html` property > `<template>`
child > `src` > legacy `content` attribute.

### Methods

- `render(): Promise<void>` -- explicit render. Works even in `render-mode="manual"`.
- `refresh(): Promise<void>` -- alias of `render()`; the documented way to force a re-render in `render-mode="once"`.
- `clear(): void` -- empties the rendered root and aborts any in-flight fetch.
- `getRenderedRoot(): Node | null` -- the element actually holding rendered content (a dedicated wrapper, not the host element itself and not the shadow root directly).

### Events

All events bubble and are namespaced `safe-fragment:*`:

| Event                         | Cancelable | Detail                                                                                                                                                             |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `safe-fragment:before-render` | Yes        | `{ profile, sourceKind }` -- `preventDefault()` vetoes the render.                                                                                                 |
| `safe-fragment:render`        | No         | `{ report: SanitizationReport, root: Node }`                                                                                                                       |
| `safe-fragment:reject`        | No         | `{ code, message, details? }` -- see [Error codes](#error-codes).                                                                                                  |
| `safe-fragment:action`        | No         | `{ action, element, originalEvent }` -- `ui-v1`'s `data-action` delegation.                                                                                        |
| `safe-fragment:link`          | No         | `{ href, target, element, originalEvent }` -- fires before a rendered `<a>` navigates; call `preventDefault()` on `originalEvent` to intercept (e.g. SPA routing). |

## Profiles

Full detail: [docs/profiles.md](docs/profiles.md).

| Profile         | Status                                                      | Summary                                                                                  |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `plain-text-v1` | Fully implemented, tested                                   | No HTML parsing at all -- `textContent` only.                                            |
| `article-v1`    | Fully implemented, tested                                   | Rich read-mostly content: prose, headings, lists, tables, links, images.                 |
| `ui-v1`         | Fully implemented, tested                                   | Layout/interactive elements + app-registered custom elements + `data-action` delegation. |
| `email-v1`      | **Scaffold** -- see [Known limitations](#known-limitations) | Restrictive table-layout-friendly subset; no `cid:`/VML/MSO-comment handling yet.        |

Register a custom element for `ui-v1`:

```ts
import { defineProfile } from "@johnhenry/safe-fragment";

defineProfile("ui-v1", {
  customElements: [{ tag: "rating-stars", attributes: ["value", "max"] }],
});
```

## The `src` remote-fetch capability

Disabled by default. Enable explicitly, with an origin allowlist:

```ts
registerSafeFragment({
  fetch: {
    enabled: true,
    allowedOrigins: ["https://cdn.example.com"], // same-origin is always allowed once enabled
    maxBytes: 250_000, // default
    timeoutMs: 8_000, // default
  },
});
```

GET-only (not configurable), size-capped during streaming (not just via a
`Content-Length` header, which can lie or be absent), and
supersession-safe: `render()`-token-checked plus its own `AbortController`,
aborted on every subsequent `render()` call, so a slow, stale fetch can
never overwrite a newer render's output. See
`src/source/fetch.ts` and `test/integration/fetch-source.test.ts`.

## `<example-sandbox>`

A **separate** component for running arbitrary, application-authored,
**executable** code examples (documentation playgrounds, live demos) --
never for untrusted user input.

```js
import { registerExampleSandbox } from "@johnhenry/safe-fragment";
registerExampleSandbox();
```

```html
<example-sandbox height="200px">
  <template> console.log("Hello from the sandbox"); document.getElementById("app").textContent = "rendered inside the iframe"; </template>
</example-sandbox>
```

Runs inside an iframe sandboxed with only `allow-scripts` (no
`allow-same-origin`, no `allow-top-navigation`, no `allow-popups`).
Communicates back via a narrow `postMessage` protocol
(`example-sandbox:ready` / `example-sandbox:message` /
`example-sandbox:error`), authenticated by `event.source` identity, not
`event.origin` (which is opaque/`"null"` by design here). **Makes no
safety claim about the code it runs** -- see
[ADR 0001](docs/adr/0001-html-as-data-not-code.md) and the module doc
comment in `src/sandbox/example-sandbox-element.ts`.

## Error codes

`SafeFragmentError#code` (also `reject` event `detail.code`) is a stable
string enum -- switch on it, not on `.message`. Full list in
`src/errors.ts`: `AMBIGUOUS_SOURCE`, `NO_SOURCE`, `PARSE_FAILED`,
`UNKNOWN_PROFILE`, `PROFILE_MISMATCH`, `SANITIZE_FAILED`,
`SANITIZER_UNAVAILABLE`, `FETCH_DISABLED`, `FETCH_ORIGIN_NOT_ALLOWED`,
`FETCH_METHOD_NOT_ALLOWED`, `FETCH_SIZE_EXCEEDED`, `FETCH_TIMEOUT`,
`FETCH_ABORTED`, `FETCH_FAILED`, `FETCH_NON_2XX`, `FETCH_SUPERSEDED`,
`DISABLED`, `UNSUPPORTED_ENVIRONMENT`, `RENDER_ABORTED`.

## Known limitations

Honest accounting of solid vs. scaffolded, per the build's stated
priority order:

**Solid -- implemented and covered by the real (Vitest Browser Mode +
Playwright Chromium) test suite, including the adversarial XSS corpus
against both sanitization engines:**

- Core sanitizer pipeline (`enforceProfile` + both engines).
- `plain-text-v1`, `article-v1`, `ui-v1` profiles.
- `<safe-fragment>`'s full lifecycle: source precedence, `strict` mode,
  render modes, microtask coalescing, render-token supersession, light/
  shadow scope, all five events, `data-action`/link delegation.
- The `src` fetch capability model (disabled-by-default, origin allowlist,
  size cap including streamed bodies, timeout, supersession).
- `<example-sandbox>`, including a direct isolation-proof test
  (`parent.document` access throws inside the sandbox).

**Scaffolded / explicitly incomplete:**

- **`email-v1`** is a thin starting point, not hardened against real-world
  HTML email quirks (`cid:` URLs, Outlook VML, MSO conditional comments) --
  see `src/profiles/email-v1.ts` and docs/profiles.md.
- **No public API to register an entirely new named profile** -- only
  `defineProfile()` for extending `ui-v1`'s custom-element allowlist.
  Applications needing a different allowlist today must compose against
  `ProfileDefinition` directly (`src/policy/profile.ts`) and call
  `sanitize()` themselves rather than going through `<safe-fragment
profile="...">`.
- **No SVG/MathML support in any profile.** Excluded entirely for v1 given
  how much of the classic XSS-bypass literature specifically targets
  those namespaces (`<svg onload>`, `xlink:href` abuse) -- a future,
  carefully-scoped `svg-safe-v1` is out of scope for this build.
- **`loading="lazy"`** uses `IntersectionObserver` when available and
  falls back to eager rendering when it isn't (rather than never
  rendering) -- not independently stress-tested beyond the unit-level
  behavior.
- Examples (`examples/`) are runnable, not a full documentation site --
  four scenarios (an interactive playground, plus single-scenario article
  viewer / `ui-v1` protocol demo / sandbox playground versions of the same
  ideas). See [Try it live](#try-it-live).
- **`SanitizationReport` only records what `enforceProfile()` itself
  removed, not what the underlying sanitizer engine (native Sanitizer API
  / DOMPurify) already stripped as its own baseline defense before
  `enforceProfile` ever sees the DOM.** For a compound payload (e.g. an
  `onerror` handler alongside a profile-disallowed element), the report
  can under-count real removals -- the dangerous attribute is genuinely
  gone from the output, but `removedAttributes` won't mention it. Found
  while building `examples/playground/`'s live report panel, which
  surfaces this explicitly rather than hiding it. Attributing engine-level
  removals to the report would need a before/after DOM diff around the
  engine call and hasn't been done -- flagged for review, not fixed here.

## What still needs human review

This was built end-to-end by an AI agent against a detailed specification
and passes its own test suite, but has **not** had independent human
security review. Before trusting this with real, adversarial user content:

- **Independent review of `src/sanitize/enforce.ts` and
  `src/policy/url.ts`** -- these two files are the actual security
  boundary; everything else is defense-in-depth around them.
- **A wider adversarial corpus.** `test/security/fixtures/xss-corpus.ts`
  covers the classes of attack named in the original spec (img/onerror,
  javascript: URLs, svg/onload, MathML xlink:href, obfuscated protocols,
  formaction, srcdoc, parser-confusion, inline style, custom-element
  abuse) but is not exhaustive -- a professional fuzzing pass or a known
  XSS cheat-sheet (e.g. OWASP's) cross-check would materially increase
  confidence.
- **Native Sanitizer API config correctness across real browsers.** This
  was verified in headless Chromium (which does support `Element#setHTML`
  as of the version bundled with the Playwright release used to build
  this); Safari/Firefox support and any behavioral differences in the
  native path have not been checked.
- **DOMPurify version pinning and update policy.** `dompurify` is a real,
  un-pinned (`^`) dependency; a supply-chain or regression review of the
  update policy is a reasonable pre-production step.
- **Load-bearing review of the `enforceProfile` hard-denylist** (`on*`,
  `formaction`, `srcdoc`, `action`, `xlink:href`) for completeness against
  attribute-based attack vectors this build's author may not have
  considered.
- **The `email-v1` scaffold**, before it is used for anything beyond a
  starting point.

## Family

Extracted conceptually from the same `johnhenry/lib` -> `domkit`/`domable`
lineage in spirit -- constrained, versioned DOM rendering -- but is an
independent, standalone, security-focused package with **no code
dependency** on either. This is a genuinely new package (never published
under any other name), so there is no provenance note beyond this one.

- [`@johnhenry/domable`](https://github.com/johnhenry/domable) -- HTML
  text/DOM/React-shape conversions and a hyperscript builder. Not a
  dependency of this package; `safe-fragment` builds its own DOM directly
  from sanitized fragments rather than composing through domable's
  `createElement`.
- [`@johnhenry/domkit`](https://github.com/johnhenry/domkit) -- a toolkit
  of custom-element/shadow-DOM authoring primitives built on domable.
  Also not a dependency -- `safe-fragment`'s custom elements are built
  directly against the platform Custom Elements API (via the
  factory-function pattern in docs/architecture.md) to keep the
  security-critical code path free of any indirection this package
  doesn't control the audit surface of.

The one real, justified runtime dependency is
[DOMPurify](https://github.com/cure53/DOMPurify), used only as the
fallback sanitization engine (see
[ADR 0002](docs/adr/0002-native-sanitizer-with-dompurify-fallback.md)) --
never vendored, never used with its permissive defaults.

## License

MIT
