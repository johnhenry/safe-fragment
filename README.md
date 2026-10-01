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
The same pipeline is available without the element as
`sanitizeToFragment()`.

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

- [Install](#install)
  - [No bundler / import map](#no-bundler--import-map)
- [Quick start](#quick-start)
- [Try it live](#try-it-live)
- [`<safe-fragment>` API](#safe-fragment-api)
- [Profiles](#profiles)
- [Adding a new profile](#adding-a-new-profile)
- [Sanitizing without the element](#sanitizing-without-the-element)
- [The `src` remote-fetch capability](#the-src-remote-fetch-capability)
- [`<example-sandbox>`](#example-sandbox)
- [Error codes](#error-codes)
- [Known limitations](#known-limitations)
- [What still needs human review](#what-still-needs-human-review)
- [Security model](#security-model)
- [Family](#family)
- [License](#license)

## Install

```bash
npm install @johnhenry/safe-fragment
```

**Provenance.** A new package: never published under any other name, and
`0.0.0` is the unreleased development version (there is nothing on npm yet),
so there is no earlier name or version to migrate from.

`dompurify` (pinned to an exact version) is a normal dependency, installed
automatically; it is loaded lazily, only on browsers without
`Element.setHTML` (Safari today) or when you force the fallback. The shipped
ESM/CJS output targets evergreen browsers; Node >= 26 is only the toolchain
(`devEngines`). Importing the package in Node/SSR is safe: nothing touches
the DOM until you call a `register*` function.

### No bundler / import map

The fallback engine does `import("dompurify")`, a bare specifier. With a
bundler it just resolves. With none (a static page, `<script type="module">`),
either map it:

```html
<script type="importmap">
  { "imports": { "dompurify": "https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.es.mjs" } }
</script>
```

or hand safe-fragment the factory yourself:

```js
registerSafeFragment({
  loadDOMPurify: () => import("https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.es.mjs").then((m) => m.default),
});
```

If neither is in place and the browser needs the fallback, rendering rejects
with `SANITIZER_UNAVAILABLE`, whose message says exactly this. Call
`await preloadSanitizer()` at startup to pay the load once and surface the
problem early (it resolves `"native"` without loading anything where
`setHTML` exists, and is what makes the synchronous API usable on Safari).

**With [mport](https://github.com/johnhenry/mport):** on raw-file CDNs
(jsDelivr, unpkg) the import map only contains entry points you ask for, so
list `dompurify` explicitly:
`npx @johnhenry/mport build @johnhenry/safe-fragment@0 dompurify@3.4.16`.
Use the exact version this release pins. The `examples/` pages each carry an
import map for it.

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
npm run build && npx serve .
```

Then open **`/examples/04-playground/`** -- type or paste HTML, or click a
real attack from the test corpus (img `onerror`, `javascript:` links, `svg
onload`, formaction hijacking). One box renders it completely unprotected
(literal `innerHTML` in a sandboxed iframe -- if something fires, you'll see
it happen); the other renders the same input through `<safe-fragment>`. A
second tab demos the `ui-v1` "content requests, host decides" action
protocol with a live application log.

The other three examples are smaller, single-scenario versions of the same
ideas, each also exercised by `test/examples/examples-smoke.test.ts`; see
[`examples/README.md`](examples/README.md) for what each demonstrates.
`serve` needs the repo's `serve.json` (`cleanUrls: false`, already present),
or its URL rewriting breaks the examples' relative `./main.mjs` imports.

## `<safe-fragment>` API

### Attributes / properties

Every attribute has a property and every property reflects its attribute.
Enumerated values are matched case-insensitively. Properties set before the
element was upgraded (frameworks, scripts that ran before
`registerSafeFragment()`) are replayed through the setters on first connect.

| Attribute     | Property      | Notes                                                                                                                                                                                                                                     |
| ------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile`     | `.profile`    | Required. Name of a registered profile (`plain-text-v1`, `article-v1`, `ui-v1`, `email-v1`, `component-template-v1`, or one you registered). There is no default.                                                                         |
| --            | `.html`       | Highest-precedence markup source. `undefined` behaves like `null`; a non-string is rejected with `INVALID_SOURCE`. Setting it schedules a render.                                                                                         |
| `src`         | `.source`     | URL to fetch markup from. Disabled by default -- see [below](#the-src-remote-fetch-capability).                                                                                                                                           |
| `content`     | --            | Legacy, lowest-precedence source. Emits a `console.warn` when used.                                                                                                                                                                       |
| `render-mode` | `.renderMode` | `"replace"` (default) \| `"once"` \| `"manual"`. `clear()` and disabling reset `once`, so a later change renders again.                                                                                                                   |
| `scope`       | `.scope`      | `"light"` (default) \| `"shadow"`. Switching scope removes the stale wrapper. See [ADR 0003](docs/adr/0003-shadow-dom-is-not-sandboxing.md).                                                                                              |
| `id-policy`   | `.idPolicy`   | `"prefix"` (default) \| `"keep-in-shadow"`. The latter keeps author ids and is honored only with `scope="shadow"`; otherwise the render rejects with `INVALID_OPTION`. See [docs/profiles.md](docs/profiles.md#ids-inside-a-shadow-root). |
| `loading`     | `.loading`    | `"eager"` (default) \| `"lazy"` -- defers a `src` fetch until the element intersects the viewport. A changed `src` goes back through the gate; a reconnect re-arms it.                                                                    |
| `disabled`    | `.disabled`   | Clears the content, cancels any in-flight render and suspends rendering.                                                                                                                                                                  |
| `strict`      | `.strict`     | When present, more than one simultaneous markup source is an `AMBIGUOUS_SOURCE` rejection instead of silently picking by precedence.                                                                                                      |
| `debug`       | `.debug`      | `console.warn`s the code/message of every `reject` event.                                                                                                                                                                                 |
| --            | `.sourceKind` | Read-only: which source `render()` would use now (`html-property`, `template-child`, `src`, `content-attribute`, `none`, `ambiguous`).                                                                                                    |

**Source precedence** (highest first): `.html` property > `<template>`
child > `src` > legacy `content` attribute. Edits to a `<template>` source
child (its content, or the template being added, removed or replaced) are
observed and re-render, subject to `render-mode`.

### Methods

- `render(): Promise<RenderResult>` -- explicit render, works in `render-mode="manual"`, and supersedes a queued automatic render. Never rejects; resolves with `{ status, error?, report? }`:
  - `rendered` -- the sanitized content is in the DOM; `report` is the `SanitizationReport`.
  - `rejected` -- nothing was rendered; `error` is a `SafeFragmentError` and a `safe-fragment:reject` event fired. **Previously rendered content is cleared** (so content never stays on screen under a profile or source the element no longer claims), except when a `before-render` listener vetoed the render (`RENDER_ABORTED`), which leaves it alone.
  - `superseded` -- a newer render, `clear()`, disabling or a disconnect overtook it; `error` is `FETCH_SUPERSEDED`/`FETCH_ABORTED` when a fetch was cut short. No event fires.
  - `disabled` -- the element is disabled (`error.code === "DISABLED"`, also dispatched as `reject`).
- `refresh(): Promise<RenderResult>` -- an alias of `render()`, kept because it reads better where you re-fetch a `src`; identical behavior, including in `render-mode="once"`.
- `clear(): void` -- empties the rendered root, cancels any in-flight render (nothing already started can land afterwards) and resets `once` mode.
- `getRenderedRoot(): Element | null` -- the wrapper element holding the rendered content (a dedicated child, not the host itself and not the shadow root).

**Lifecycle.** Moving an element within the DOM (or re-attaching it) does not
re-render or refetch when its source, profile and scope are unchanged. An
element moved to another document (a pop-out window) re-arms its observers
against the new window. `src` fetches and `IntersectionObserver`s are torn
down on disconnect and when the element's own window fires `pagehide` (removing an
`<iframe>` does not run `disconnectedCallback` for what is inside it).
`before-render` fires once a render actually starts with a valid source and
profile (never for `NO_SOURCE`, `INVALID_SOURCE`, `UNKNOWN_PROFILE`, ...).

### Events

All events bubble and are namespaced `safe-fragment:*`:

| Event                         | Cancelable | Detail                                                                                                                                                             |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `safe-fragment:before-render` | Yes        | `{ profile, sourceKind }` -- `preventDefault()` vetoes the render.                                                                                                 |
| `safe-fragment:render`        | No         | `{ report: SanitizationReport, root: Node }`                                                                                                                       |
| `safe-fragment:reject`        | No         | `{ code, message, details? }` -- see [Error codes](#error-codes).                                                                                                  |
| `safe-fragment:clear`         | No         | `{ reason: "clear" \| "disabled" \| "rejected" }` -- rendered content was removed.                                                                                 |
| `safe-fragment:disabled`      | No         | -- the element was just disabled.                                                                                                                                  |
| `safe-fragment:action`        | No         | `{ action, element, originalEvent }` -- `data-action` delegation (any profile that allows it, i.e. `ui-v1`). Works under `scope="shadow"` (via `composedPath()`).  |
| `safe-fragment:link`          | No         | `{ href, target, element, originalEvent }` -- fires before a rendered `<a>` navigates; call `preventDefault()` on `originalEvent` to intercept (e.g. SPA routing). |

### TypeScript

The package ships types for the element: the `SafeFragmentElement` interface,
a `SafeFragmentEventMap` so `el.addEventListener("safe-fragment:render", (e) => e.detail.report)`
is typed, and an `HTMLElementTagNameMap` augmentation (`document.createElement("safe-fragment")`
returns a `SafeFragmentElement` after `registerSafeFragment()`; appended to the built `.d.ts` files, not present in the TypeScript source, so the package can be published to JSR). The class itself is
exported as `createSafeFragmentElementClass(HTMLElement, deps)` and
`getSafeFragmentElementClass()`.

## Profiles

Full detail: [docs/profiles.md](docs/profiles.md).

| Profile                 | Status                                                    | Summary                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plain-text-v1`         | Fully implemented, tested                                 | No HTML parsing at all -- `textContent` only.                                                                                                                     |
| `article-v1`            | Fully implemented, tested                                 | Rich read-mostly content: prose, headings, lists, tables, links, images.                                                                                          |
| `ui-v1`                 | Fully implemented, tested                                 | Layout/interactive elements, `data-action` delegation, forced `type="button"`. No classes by default (`allowedClasses`). Derive a profile to add custom elements. |
| `component-template-v1` | Fully implemented, tested                                 | `ui-v1` plus `<slot>` and `part`/`slot`/`exportparts`, for a web component's template. Opt-in `idPolicy: "keep-in-shadow"`. No `<style>`.                         |
| `email-v1`              | Implemented, email corpus; not yet independently reviewed | Table-layout subset with the legacy layout attributes; `cid:` images through your `resolveCid`; MSO comments and VML removed; blocks relative auto-loading URLs.  |

SVG and MathML are **opt-in** profile options, off in every built-in:
`svg: "static"` (shapes, paths, text, gradients, same-fragment `use`) and
`mathml: "presentation"` (presentation elements only). `class` is an
allowlist, `allowedClasses`, and `ui-v1` allows none. See
[docs/profiles.md](docs/profiles.md#svg-and-mathml-opt-in) and
[ADR 0010](docs/adr/0010-svg-and-mathml-opt-in.md) / [ADR 0011](docs/adr/0011-class-allowlist.md).

The built-ins are frozen and versioned (`name`, `version`); nothing mutates
them. Register your own, or derive one from a built-in:

```ts
import { registerProfile, deriveProfile } from "@johnhenry/safe-fragment";

registerProfile(
  deriveProfile("ui-v1", {
    name: "my-ui-v1",
    customElements: [
      { tag: "rating-stars", attributes: ["value", "max"] },
      { tag: "ui--*", attributes: ["role"] }, // prefix pattern: ui--card, ui--stat, ...
    ],
  }),
);
// <safe-fragment profile="my-ui-v1"> ...
```

`registerProfile` validates (typed `INVALID_PROFILE`/`PROFILE_MISMATCH` errors:
no dangerous elements, `on*`/`style` attributes, dangerous schemes, wildcard
`data-*`, reserved custom-element names such as `font-face`);
`unregisterProfile(name)` removes one you added. `PLAIN_TEXT_V1`, `ARTICLE_V1`,
`UI_V1`, `EMAIL_V1` and `COMPONENT_TEMPLATE_V1` are exported **name strings** (use `getProfile(ARTICLE_V1)` for
the definition).

## Adding a new profile

**In your application** (no fork needed): derive from a built-in, give it a
new name that ends in `-v<N>` with a matching `version`, and register it
before the first render. A profile can only narrow or extend within the
validated envelope (no dangerous elements, `on*`/`style`, or dangerous
schemes).

```ts
registerProfile(deriveProfile("article-v1", { name: "comments-v1", version: 1, urlSchemes: ["relative", "https:"] }));
```

**In this repository** (a new built-in `foo-v1`):

1. Add `src/profiles/foo-v1.ts` exporting a deeply frozen `FOO_V1_PROFILE`
   (the shape is `ProfileDefinition` in `src/policy/profile.ts`; copy the
   closest existing profile).
2. Add it to the seed list in `src/policy/registry.ts` and export its
   name-string constant (`FOO_V1`) from `src/index.ts`.
3. Add it to the invariants in `test/unit/profiles.test.ts` (no dangerous
   scheme/element, no `style`, no `on*`).
4. Add fixtures to `test/fixtures/xss-corpus.ts` **and**
   `test/fixtures/benign-corpus.ts`; the equivalence suite runs both through
   both engines, and the benign corpus is what catches a sanitizer that
   deletes everything.
5. Document it in `docs/profiles.md` and the table above, and add a
   `CHANGELOG.md` entry. A change to a shipped profile's output is a new
   version (`foo-v2`), never an edit to `foo-v1`.

## Sanitizing without the element

```ts
import { sanitizeToFragment, sanitizeToFragmentSync, preloadSanitizer } from "@johnhenry/safe-fragment";

const { fragment, report } = await sanitizeToFragment(untrustedHtml, { profile: "article-v1" });
target.replaceChildren(fragment); // a detached, profile-conformant DocumentFragment

await preloadSanitizer(); // once, at startup
const sync = sanitizeToFragmentSync(untrustedHtml, { profile: "article-v1" });
```

Same pipeline, same guarantees, same `SanitizationReport`; options are
`{ profile, document?, maxInputLength?, baseUrl?, idPolicy?, resolveCid?, inertRealm?, loadDOMPurify? }` (`idPolicy: "keep-in-shadow"` keeps author ids and is safe only if you insert the fragment into a shadow root; see [docs/profiles.md](docs/profiles.md#ids-inside-a-shadow-root). `resolveCid` maps `cid:` content-ids to URLs for `email-v1`; the library never fetches them, see [docs/profiles.md](docs/profiles.md#email-v1). `inertRealm` (`"auto"` | `"iframe"` | `"document"`) picks where the engines parse, see [Known limitations](#known-limitations) and [ADR 0012](docs/adr/0012-parse-realm-iframe-for-csp.md)). The sync
variant works only when the native engine exists or DOMPurify was already
prepared; otherwise it throws `SANITIZER_NOT_READY` -- it fails closed. This is
the entry point for template systems that need a sanitizer hook. The report
lists what both the engine and `enforceProfile` removed
(`removedElements`, `removedAttributes`, `rewrittenUrls`); `outputLength` is an
approximation.

## The `src` remote-fetch capability

Disabled by default. Enable explicitly, with an origin allowlist:

```ts
registerSafeFragment({
  fetch: {
    enabled: true,
    allowedOrigins: ["https://cdn.example.com"], // same-origin is always allowed once enabled
    maxBytes: 250_000, // default
    timeoutMs: 8_000, // default; stays armed until the body is fully read
    followRedirects: false, // default: redirects are refused (redirect: "error")
  },
  maxInputLength: 1_000_000, // default; applies to every source, not just src
});
```

GET-only (not configurable), size-capped during streaming (not just via a
`Content-Length` header, which can lie or be absent), and never lets a stale
fetch overwrite a newer render: each render has its own `AbortController` and
token, the previous one is aborted when a new render starts, and every `await`
re-checks both. With `followRedirects: true` the final `response.url` is
re-validated against the same-origin/`allowedOrigins` policy
(`FETCH_REDIRECT_NOT_ALLOWED` otherwise). See `src/source/fetch.ts` and
`test/integration/fetch-source.test.ts`.

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

Under a CSP with `require-trusted-types-for 'script'`, add the policy name
`safe-fragment-sandbox` (configurable: `registerExampleSandbox({ trustedTypesPolicyName })`)
to `trusted-types`. The component creates that policy only to set the sandbox
document and compile the code sample, both application-authored; if the name
is not allowed, you get an `example-sandbox:error` event and no iframe.

## Error codes

`SafeFragmentError#code` (also `reject` event `detail.code`, and
`RenderResult#error.code`) is a stable string enum -- switch on it, not on
`.message`. `instanceof SafeFragmentError` also holds across the ESM and CJS
builds.

| Code                         | Surfaces as                      | Meaning                                                                                      |
| ---------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `AMBIGUOUS_SOURCE`           | `reject`                         | More than one markup source while `strict`.                                                  |
| `NO_SOURCE`                  | `reject`                         | No `.html`, `<template>`, `src` or `content`.                                                |
| `INVALID_SOURCE`             | `reject`, throw                  | The source is not a string.                                                                  |
| `INVALID_OPTION`             | `reject`, throw                  | An option outside its allowed set, or `id-policy="keep-in-shadow"` without `scope="shadow"`. |
| `SOURCE_TOO_LARGE`           | `reject`, throw                  | The source exceeds `maxInputLength`.                                                         |
| `UNKNOWN_PROFILE`            | `reject`, throw                  | The profile is missing or not registered.                                                    |
| `PROFILE_MISMATCH`           | throw (`registerProfile`)        | A `-vN` name suffix disagrees with `version`.                                                |
| `INVALID_PROFILE`            | throw                            | A profile definition or `registerProfile`/`deriveProfile` arguments are invalid.             |
| `SANITIZE_FAILED`            | `reject`, throw                  | The engine threw while sanitizing.                                                           |
| `SANITIZER_UNAVAILABLE`      | `reject`, throw                  | DOMPurify is needed but cannot be loaded (the message says how to fix it).                   |
| `SANITIZER_NOT_READY`        | throw (`sanitizeToFragmentSync`) | No engine is ready synchronously; call `preloadSanitizer()`.                                 |
| `FETCH_DISABLED`             | `reject`                         | `src` used without enabling the fetch capability.                                            |
| `FETCH_ORIGIN_NOT_ALLOWED`   | `reject`                         | The URL's origin is neither the page's nor in `allowedOrigins`.                              |
| `FETCH_REDIRECT_NOT_ALLOWED` | `reject`                         | With `followRedirects`, the final origin is not allowed.                                     |
| `FETCH_SIZE_EXCEEDED`        | `reject`                         | The body exceeds `maxBytes` (header or streamed).                                            |
| `FETCH_TIMEOUT`              | `reject`                         | The fetch, including reading the body, exceeded `timeoutMs`.                                 |
| `FETCH_FAILED`               | `reject`                         | Network failure (including mid-stream, and a refused redirect).                              |
| `FETCH_NON_2XX`              | `reject`                         | The response was not ok.                                                                     |
| `FETCH_SUPERSEDED`           | `render()` result only           | A newer render overtook the fetch. No event.                                                 |
| `FETCH_ABORTED`              | `render()` result only           | `clear()`, disabling, disconnecting or page hide cut the fetch short. No event.              |
| `DISABLED`                   | `reject`, `render()` result      | `render()` was called on a disabled element.                                                 |
| `RENDER_ABORTED`             | `reject`, `render()` result      | A `before-render` listener cancelled the render.                                             |
| `UNSUPPORTED_ENVIRONMENT`    | throw                            | A `register*`/`sanitizeToFragment` call without a DOM.                                       |

## Known limitations

Solid -- implemented and covered by the Vitest Browser Mode suite (real
Chromium, WebKit and Firefox; the Firefox run is CI-only because it cannot
launch in the maintainer's sandbox), including the adversarial XSS corpus and
a benign-content corpus compared across both sanitization engines:

- The sanitizer pipeline (both engines, `enforceProfile`, rebuild), the report, and the public `sanitizeToFragment` API.
- `plain-text-v1`, `article-v1`, `ui-v1`, `component-template-v1`, `email-v1` (with its corpus); opt-in static SVG and presentation MathML (both engines compared, with an adversarial namespace-confusion corpus); the class allowlist; custom profiles via `registerProfile`.
- A seeded mutation-XSS differential fuzzer (`test/fuzz/`, [the reviewer packet](docs/review/README.md#the-fuzzer)): small deterministic budget in `npm test`, `npm run fuzz` for long runs.
- `<safe-fragment>`'s lifecycle, `render()` results, events, shadow/light scope, `loading="lazy"`.
- The `src` fetch capability model.
- `<example-sandbox>`, including a direct isolation-proof test and Trusted Types support.

Known gaps (each has an issue):

- **No independent security review yet** ([safe-fragment#1](https://github.com/johnhenry/safe-fragment/issues/1)). Do not release or rely on this for hostile content before it.
- **`email-v1` has no CSS**: inline `style=` and `<style>` are how mail is styled, and both are unsupported, so a "hidden" preheader becomes visible and CSS colours are lost; remote `https:` images load (tracking pixels) unless you derive a profile without `https:` ([ADR 0009](docs/adr/0009-email-v1.md), [safe-fragment#2](https://github.com/johnhenry/safe-fragment/issues/2)).
- **SVG and MathML are opt-in and partial** ([ADR 0010](docs/adr/0010-svg-and-mathml-opt-in.md), [safe-fragment#3](https://github.com/johnhenry/safe-fragment/issues/3)): no animation, `image`, `foreignObject`, filters or `style`; and **`<use>` is removed by the native engine** (Chromium) while DOMPurify keeps a same-fragment one, so it works only on Safari/fallback.
- **On Chromium the engines parse in a hidden same-origin `about:blank` iframe** (`inertRealm: "auto"`, [ADR 0012](docs/adr/0012-parse-realm-iframe-for-csp.md), [safe-fragment#13](https://github.com/johnhenry/safe-fragment/issues/13)), because Chromium's HTML parser reports CSP violations (`style-src-attr` for `style=`, `style-src-elem`/`base-uri` on the DOMPurify engine) while parsing hostile input in every other document context, although the output is clean. The iframe is empty, scriptless and hidden, one per document; it is visible to `querySelectorAll("iframe")` and observers. Set `inertRealm: "document"` to never add it (and accept the reports). A page that sandboxes or blocks the iframe falls back to the old behavior. Firefox and Safari are unaffected and unchanged.
- **The native Sanitizer API spec is still moving**; only Chromium (and, per CI, Firefox) ship `setHTML`, and Safari takes the DOMPurify path ([safe-fragment#4](https://github.com/johnhenry/safe-fragment/issues/4)).
- **DOMPurify's cost is quadratic in removed nodes**: `maxInputLength` bounds it, it does not remove it ([safe-fragment#5](https://github.com/johnhenry/safe-fragment/issues/5)).
- **`article-v1`/`ui-v1` keep relative `img src`**, a same-origin GET on render; opt in to `blockRelativeAutoLoadUrls` ([safe-fragment#6](https://github.com/johnhenry/safe-fragment/issues/6)).
- **`<style>` is not supported** in any profile (dropped with its content): sanitizing CSS is a separate, larger security surface ([ADR 0006](docs/adr/0006-style-element-is-a-non-goal.md), [safe-fragment#11](https://github.com/johnhenry/safe-fragment/issues/11)). Keep component stylesheets outside the sanitized template; see [docs/profiles.md](docs/profiles.md#styles).
- `part` (component templates) is a styling hook the host stylesheet can target, the same class of exposure as `class` was ([ADR 0005](docs/adr/0005-component-templates-and-id-policy.md)).
- **The native path's report cannot count the engine's own unconditional removals** (`<script>`, `<iframe>`, `on*` handlers, `javascript:` URLs; [safe-fragment#8](https://github.com/johnhenry/safe-fragment/issues/8), [ADR 0007](docs/adr/0007-no-gated-sink-in-the-native-report.md)): counting them needs a Trusted-Types-gated parse, which this package never makes, so sanitizing produces zero CSP violations. It lists everything the profile removed, and on DOMPurify the log also includes those baseline removals.
- `loading="lazy"` falls back to eager rendering when `IntersectionObserver` is missing (rather than never rendering).
- `FETCH_ABORTED`/`FETCH_SUPERSEDED` are reported through `render()`'s result only, never as events: an abort you caused is not a failure.

## What still needs human review

This was built end-to-end by AI agents against specifications and audits, and
passes its own test suite, but has **not** had independent human security
review ([safe-fragment#1](https://github.com/johnhenry/safe-fragment/issues/1)). Before trusting this with real, adversarial user content:

- **Independent review of `src/sanitize/enforce.ts`, `src/sanitize/rebuild.ts` and `src/policy/url.ts`** -- the actual security boundary; everything else is defense-in-depth around them. Also `src/policy/registry.ts` validation of custom profiles.
- **The adversarial corpora and the fuzzer.** `test/fixtures/xss-corpus.ts`, `email-corpus.ts` and `foreign-corpus.ts` plus clobbering, tabnabbing and srcset suites, and the mutation-XSS fuzzer (`test/fuzz/`, ADR 0008: it found four real issues, all fixed) are broad but not exhaustive: an OWASP cheat-sheet cross-check and a long fuzz run per browser release would still add confidence. The reviewer packet, [docs/review/](docs/review/README.md), is the starting point.
- **Native Sanitizer API behavior per browser release** ([safe-fragment#4](https://github.com/johnhenry/safe-fragment/issues/4)). Verified in Chromium and WebKit locally and Firefox in CI; the equivalence test has one documented Firefox divergence (`noscript`, scripting-flag parse).
- **The DOMPurify version.** It is pinned to an exact version because profile output stability depends on it; the bump policy is in AGENTS.md. A supply-chain review of the dependency is still a reasonable pre-production step.
- **The hard denylist** (`on*`, `formaction`, `srcdoc`, `action`, `xlink:href`) and the always-checked URL-attribute list for completeness against attribute-based vectors.
- **`email-v1` (`cid:` resolution, `dropElements`) and the SVG/MathML grammars** (`src/policy/cid.ts`, `src/policy/foreign.ts`, `src/sanitize/enforce-foreign.ts`): new surface since the first audit pass.

## Security model

**What safe-fragment guarantees:**

- **Untrusted strings never reach an unsafe DOM sink.** `innerHTML`,
  `outerHTML`, `insertAdjacentHTML`, `setHTMLUnsafe` (and equivalents) are
  never called with unsanitized input anywhere in this codebase -- parsing
  and allowlist enforcement always happen together, in an inert document,
  before anything touches a live one. See
  [ADR 0001](docs/adr/0001-html-as-data-not-code.md).
- **Every render goes through a closed, versioned allowlist**, not a
  denylist, enforced by `enforceProfile()`. An element or attribute not
  explicitly listed in the active profile is removed -- raw-text/embedding
  containers with their whole subtree, other disallowed elements unwrapped,
  identically in both engines ([ADR 0004](docs/adr/0004-disallowed-elements-unwrap-or-drop.md))
  -- never "escaped and left in place." The output is rebuilt from fresh nodes.
- **URL filtering uses the platform `URL` parser, never regex**, on every
  URL-valued attribute including custom-element attributes and every
  `srcset` candidate. `javascript:`, `data:`, `vbscript:`, and `file:` are
  rejected under every shipped profile (whitespace/entity/case-obfuscated
  variants included), and protocol-relative/backslash URLs inherit the
  _document's_ scheme, not an assumed `https:`.
- **Two engines, one boundary.** The native Sanitizer API or a locked-down
  DOMPurify do the initial parse; the shared `enforceProfile()` pass then
  re-derives the allowed set from the profile. A corpus-wide test compares the
  two engines' output for the whole XSS corpus plus a benign corpus. See
  [ADR 0002](docs/adr/0002-native-sanitizer-with-dompurify-fallback.md).
- **`on*` attributes are always stripped**, even if a profile or custom
  element mistakenly lists one -- a hardcoded backstop.
- **Reverse tabnabbing is closed:** `target` survives only as `_blank`, and a
  kept target always overwrites `rel` with `noopener noreferrer`.
- **DOM clobbering is closed:** every `id` is prefixed `user-content-` and every
  in-fragment reference rewritten, so content cannot create `window.scriptUrl`
  or shadow the host page's ids.
- **`ui-v1` is inert by construction:** `<button>` is forced to
  `type="button"`, and `data-*` is an explicit allowlist (`data-action`), never a
  wildcard (framework handler attributes like `data-hx-on:click` cannot ride
  through).
- **No "unsafe"/"trusted"/"allowScripts" escape hatch exists** anywhere in the
  public API. Built-in profiles are frozen; custom profiles are validated and
  cannot allow dangerous elements, `on*`/`style`, or dangerous schemes.
- **Importing this package never touches `window`/`document`/`HTMLElement`/
  `customElements`** -- safe to `import` in Node/SSR.
- **The `src` fetch is disabled by default**, GET-only, same-origin unless
  allowlisted, redirect-refusing unless you opt in (and then re-validated),
  size-capped while streaming, time-limited until the body is read, and a
  stale fetch can never overwrite a newer render.
- **Works under Trusted Types** (`require-trusted-types-for 'script'`): one
  DOMPurify instance, hence one `dompurify` policy, per window, and no gated
  sink is ever called with a string. Parsing hostile input produces no CSP
  violations either (on Chromium via a hidden `about:blank` iframe realm,
  [ADR 0012](docs/adr/0012-parse-realm-iframe-for-csp.md)).
- **Bounded input:** `maxInputLength` (default 1,000,000 characters) rejects
  oversized sources with `SOURCE_TOO_LARGE` before parsing.

**What is still yours:**

- **Choosing the right profile.** Rendering attacker-controlled content under
  `ui-v1` (which allows interactive elements and, if you derive it so, custom
  elements and classes) when `article-v1` or `plain-text-v1` would do is a choice
  this library cannot make for you.
- **What your own custom elements do.** A derived profile lets your registered
  custom elements receive sanitized attribute values; what their
  `attributeChangedCallback` (or anything else) does with them is your code.
- **`<example-sandbox>`'s executable code is never sanitized, and is not meant
  to be.** It is a _separate_ component for application-authored, trusted code
  samples -- see [`<example-sandbox>`](#example-sandbox). Feeding it untrusted
  input is a misuse, not a bypass of `<safe-fragment>`.
- **Shadow DOM (`scope="shadow"`) is a styling convenience, not an isolation
  boundary** ([ADR 0003](docs/adr/0003-shadow-dom-is-not-sandboxing.md)).
- **Same-origin GETs from relative `img src`** under `article-v1`/`ui-v1`
  ([safe-fragment#6](https://github.com/johnhenry/safe-fragment/issues/6)), and
  **which classes your content may use**: `allowedClasses` is yours to set
  ([ADR 0011](docs/adr/0011-class-allowlist.md)).
- **Cost under the size cap on the DOMPurify path**
  ([safe-fragment#5](https://github.com/johnhenry/safe-fragment/issues/5)): lower
  `maxInputLength` if you render attacker-sized content in Safari.
- **Content-level risks this library cannot see:** a syntactically valid
  phishing link is not a code-execution bug. See
  [docs/security-model.md](docs/security-model.md) "What this package does not
  protect against".
- **The pending independent review** ([safe-fragment#1](https://github.com/johnhenry/safe-fragment/issues/1);
  [packet](docs/review/README.md)) and the moving native Sanitizer spec
  ([#4](https://github.com/johnhenry/safe-fragment/issues/4)).

Full detail: [docs/security-model.md](docs/security-model.md).

## Family

safe-fragment is the sanitizer the family reaches for when markup comes from
somewhere less trusted than your own source. It has no runtime dependency on
any sibling; the relationships are mechanisms, named below.

- **[`johnhenry/workbench`](https://github.com/johnhenry/workbench)** ([live](https://johnhenry.github.io/workbench/), [docs](https://opensource.johnhenry.me/workbench/)) -- uses safe-fragment to render untrusted note bodies.
- **[`@johnhenry/html-modules`](https://github.com/johnhenry/html-modules)** --
  html-modules stamps component templates into the page as real DOM, and its
  opt-in `sanitize` hook runs each template of a less-trusted module through a
  sanitizer before anything registers. Its `@johnhenry/html-modules/safe-fragment`
  adapter (`safeFragmentSanitizer()`) calls `sanitizeToFragment(html, { profile })`
  with a profile derived from `component-template-v1` (plus the module's own
  `ns--*` custom elements) and `idPolicy: "keep-in-shadow"`, since html-modules
  always stamps into a shadow root; the report becomes an html-modules event. A
  `<safe-fragment>` inside a component template does the same job declaratively
  for untrusted slots. safe-fragment is an optional peer of html-modules, never a
  runtime dependency, and safe-fragment depends on nothing in html-modules.
- **[`@johnhenry/window-algebra`](https://github.com/johnhenry/window-algebra)** --
  window-algebra's `htmlSurface(element)` hosts any element, so
  `htmlSurface(safeFragmentEl)` puts sanitized content in a window; it only
  calls `mount`/`unmount`, so neither package knows the other. With the default
  `scope="light"` the rendered wrapper is an ordinary child of the host, so it
  moves with the element into a pop-out document: `adoptedCallback` re-arms
  observers against the new window and, because nothing changed, nothing
  re-renders. (`scope="shadow"` also moves, but is not isolation.)
- **[`@johnhenry/mport`](https://github.com/johnhenry/mport)** -- the CDN router
  that compiles to an import map. safe-fragment's DOMPurify fallback needs a
  `dompurify` import-map entry on pages with no bundler; on raw-file CDNs list
  it explicitly (`mport build @johnhenry/safe-fragment@0 dompurify@3.4.16`) or
  let mport add it from this package's `dependencies` with `--dependencies`
  (`build(specs, { dependencies: true })`)
  (see [No bundler / import map](#no-bundler--import-map)). Not a dependency.
- [`@johnhenry/domable`](https://github.com/johnhenry/domable) -- HTML
  text/DOM/React-shape conversions and a hyperscript builder. **Not a
  dependency** of this package; `safe-fragment` builds its own DOM directly
  from sanitized fragments rather than composing through domable's
  `createElement`.
- [`@johnhenry/domkit`](https://github.com/johnhenry/domkit) -- a toolkit of
  custom-element/shadow-DOM authoring primitives built on domable. Also **not a
  dependency** -- `safe-fragment`'s custom elements are built directly against
  the platform Custom Elements API (the factory-function pattern in
  docs/architecture.md) to keep the security-critical code path free of
  indirection this package doesn't control the audit surface of.

The one real runtime dependency is [DOMPurify](https://github.com/cure53/DOMPurify)
(exact-pinned), used only as the fallback sanitization engine (see
[ADR 0002](docs/adr/0002-native-sanitizer-with-dompurify-fallback.md)) -- never
vendored, never used with its permissive defaults.

## License

MIT
