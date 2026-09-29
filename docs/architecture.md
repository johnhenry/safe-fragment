# Architecture

## Project layout

```
src/
  index.ts                    Public API surface (no DOM globals touched at module scope)
  errors.ts                   SafeFragmentError + the stable error-code enum
  types.ts                    SanitizationReport, event detail types, RenderMode/RenderScope
  platform/
    environment.ts            Lazy, function-scoped access to document/customElements/HTMLElement
  policy/
    profile.ts                ProfileDefinition shape
    registry.ts                Built-in profile registry + defineProfile()
    url.ts                     checkUrl() -- URL-parser-based scheme allowlisting (no regex)
  profiles/
    plain-text-v1.ts, article-v1.ts, ui-v1.ts, email-v1.ts
  sanitize/
    capabilities.ts            hasNativeSanitizer() feature detection
    config.ts                  Profile -> engine baseline config (elements/attributes only)
    native.ts                  Native Sanitizer API (Element#setHTML) engine
    dompurify.ts                DOMPurify fallback engine (dynamic import)
    enforce.ts                  enforceProfile() -- the authoritative allowlist pass
    index.ts                    sanitize() -- orchestrates engine selection + enforceProfile
  source/
    fetch.ts                    fetchSource() -- the `src` remote-fetch capability model
  render/
    safe-fragment-element.ts    createSafeFragmentElementClass() factory
    register.ts                  registerSafeFragment()
  sandbox/
    example-sandbox-element.ts  createExampleSandboxElementClass() factory
    register.ts                  registerExampleSandbox()
test/
  unit/          Pure-logic tests (URL policy, enforceProfile, profile shape, registry, errors)
  integration/   Custom-element lifecycle, fetch policy, example-sandbox isolation
  security/      The adversarial XSS regression corpus, run against both engines
  fixtures/      Shared fixture data (the XSS corpus itself)
examples/
  article-viewer/       article-v1 rendering a blog-post-shaped fixture
  ui-protocol-demo/     ui-v1 + data-action delegation + a registered custom element
  sandbox-playground/   <example-sandbox> running a small live code sample
docs/
  architecture.md (this file), profiles.md, security-model.md, adr/
```

## Why a factory function, not a top-level class

Every custom element class in this package (`SafeFragmentElement`,
`ExampleSandboxElement`) is built by a factory function
(`createSafeFragmentElementClass(HTMLElementBase, deps)`,
`createExampleSandboxElementClass(HTMLElementBase)`) that takes the
`HTMLElement` base class as a parameter, rather than a module declaring
`class SafeFragmentElement extends HTMLElement { ... }` at the top level.

A top-level `extends HTMLElement` dereferences the global `HTMLElement`
the moment the module is evaluated -- which throws immediately in Node/SSR,
where no such global exists. Since the project's non-negotiable
constraint is "importable in Node/SSR without crashing," every reference
to `document`/`customElements`/`HTMLElement` lives inside a function body
(`src/platform/environment.ts`, the `register*()` functions, the class
factories), and nothing at module scope ever touches them. The class is
only actually constructed -- and `HTMLElement` only actually dereferenced
-- when an application explicitly calls `registerSafeFragment()` /
`registerExampleSandbox()` from code that is actually running in a
browser.

## The render pipeline

See docs/security-model.md for the detailed, security-focused walkthrough.
At a high level, `<safe-fragment>`'s `render()`:

1. Resolves exactly one markup source per the documented precedence.
2. Resolves and validates the named profile.
3. Fires the cancelable `before-render` event.
4. Fetches (if source is `src`) or reads the raw string.
5. Calls `sanitize()`, which picks an engine and runs the shared
   `enforceProfile` pass.
6. Replaces the contents of a dedicated wrapper element
   (`getRenderedRoot()`) with the sanitized fragment.
7. Fires `render` (success) or `reject` (any failure along the way).

Renders are **microtask-coalesced**: multiple synchronous property/
attribute changes in the same tick collapse into a single `render()` call,
and **token-superseded**: each `render()` call captures a monotonically
increasing token; if a newer `render()` starts before an older one
finishes (including its `await`ed fetch/sanitize steps), the older one's
late-arriving result is silently discarded rather than clobbering the
newer one. The `src` fetch path additionally aborts its own previous
in-flight `AbortController` on every new `render()` call.

## Light DOM vs. shadow scope

`<safe-fragment>` renders into a dedicated child element marked
`data-safe-fragment-root` and `part="content"` -- in light DOM by default
(a direct child of the host element, so a `<template>` source child
coexists with the rendered output without either destroying the other on
re-render), or inside an open `ShadowRoot` when `scope="shadow"`. See
[ADR 0003](adr/0003-shadow-dom-is-not-sandboxing.md): this is a styling/
encapsulation choice, not a security one. This package deliberately ships
no default host styling (no injected stylesheet, no forced
`display: contents`) -- an application that wants `safe-fragment` to lay
out as a block element should say so in its own CSS.

## `<example-sandbox>`: a genuinely separate trust model

`<example-sandbox>` lives in its own `src/sandbox/` tree with its own
`register*()` function, on purpose -- an application that only needs
`<safe-fragment>` never has to load or register it. Its iframe is
sandboxed with only `allow-scripts` (specifically **not**
`allow-same-origin`, so the iframe's origin is opaque and it cannot
synchronously read the host page's cookies/localStorage/DOM even though
the code inside it runs for real; **not** `allow-top-navigation`, so it
cannot redirect the host page). Communication back to the host is a
narrow `postMessage` protocol (`ready`/`console`/`error`), authenticated
by comparing `event.source` to the iframe's own `contentWindow` (not by
trusting `event.origin`, which is `"null"` for an opaque-origin iframe by
design). `test/integration/example-sandbox.test.ts` verifies the
isolation directly: code that tries `parent.document.title` inside the
sandbox throws a `SecurityError`, caught and reported, rather than
succeeding.

## Known limitations

See the README's "Known limitations" section for the authoritative,
up-to-date list of what is fully implemented vs. scaffolded.
