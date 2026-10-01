# Architecture

## Project layout

```
src/
  index.ts                    Public API surface (no DOM globals touched at module scope)
  errors.ts                   SafeFragmentError + the stable error-code enum
  types.ts                    SanitizationReport, RenderResult, event detail types
  shared-state.ts             globalThis-keyed store shared by the ESM and CJS builds
  platform/
    environment.ts            Lazy, function-scoped access to document/customElements/HTMLElement
    realm.ts                  The parse realm: a hidden about:blank iframe per document on Chromium (ADR 0012)
  policy/
    profile.ts                ProfileDefinition shape + custom-element name/pattern helpers
    registry.ts               Frozen built-ins + registerProfile/unregisterProfile/deriveProfile
    url.ts                    checkUrl() -- URL-parser-based scheme allowlisting (no regex); hasScriptScheme()
    cid.ts                    `cid:` content-id extraction and the validation of a resolver's answer (email-v1)
    foreign.ts                SVG/MathML allowlists and value-grammar validators (opt-in profiles, ADR 0010)
  profiles/
    plain-text-v1.ts, article-v1.ts, ui-v1.ts, email-v1.ts   (exported as *_PROFILE definitions)
  sanitize/
    capabilities.ts           hasNativeSanitizer() feature detection
    config.ts                 Profile -> engine baseline config
    dangerous.ts              The drop-subtree element list shared by both engines + enforceProfile
    native.ts                 Native Sanitizer API (setHTML) engine, inert-document parse + report diff
    dompurify.ts              DOMPurify fallback: loader, one instance per window, hooks
    enforce.ts                enforceProfile() -- the authoritative allowlist pass
    enforce-foreign.ts        SVG/MathML branch of enforceProfile (opt-in profiles only, ADR 0010)
    rebuild.ts                Rebuilds the enforced fragment from fresh nodes
    index.ts                  sanitize()/sanitizeSync(): engine selection + enforce + rebuild
    public.ts                 sanitizeToFragment()/sanitizeToFragmentSync()
    preload.ts                preloadSanitizer()
  source/
    fetch.ts                  fetchSource() -- the `src` remote-fetch capability model
  render/
    safe-fragment-element.ts  createSafeFragmentElementClass() factory
    element-types.ts          SafeFragmentElement interface, event map (the HTMLElementTagNameMap augmentation is appended to dist/*.d.ts by scripts/append-dts.mjs)
    register.ts               registerSafeFragment(), getSafeFragmentElementClass()
  sandbox/
    example-sandbox-element.ts  createExampleSandboxElementClass() factory
    register.ts                 registerExampleSandbox()
test/
  unit/          Pure-logic tests (URL policy, enforceProfile, rebuild, profiles, registry, errors)
  integration/   Element lifecycle, fetch policy, DOMPurify loading + Trusted Types, public API, sandbox
  security/      XSS, benign, email and SVG/MathML corpora + cross-engine equivalence + clobbering, run per engine
  fuzz/          Seeded mutation-XSS differential fuzzer (grammar, oracles, harness); `npm run fuzz` for long runs
  fixtures/      Shared corpus data (xss-corpus.ts, benign-corpus.ts, email-corpus.ts, foreign-corpus.ts)
  helpers/       Shared test helpers (normalized DOM serialization)
  examples/      Smoke tests of the built examples (npm run examples)
  dist/          Node tests of the built ESM+CJS packages (npm run test:dist)
examples/
  01-article-viewer/      article-v1 rendering a blog-post-shaped fixture
  02-ui-protocol-demo/    a derived ui-v1 profile + data-action delegation + a custom element
  03-sandbox-playground/  <example-sandbox> running a small live code sample
  04-playground/          interactive: unprotected vs protected vs report
docs/
  architecture.md (this file), profiles.md, security-model.md, adr/, review/ (the independent-review packet)
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
5. Calls `sanitize()`: size check, engine selection (inert-document parse),
   the shared `enforceProfile` pass, then `rebuildFragment`.
6. Replaces the contents of a dedicated wrapper element
   (`getRenderedRoot()`) with the sanitized fragment.
7. Fires `render` (success) or `reject` (any failure along the way; stale
   content is cleared), and resolves `render()` with a result object
   (`rendered` | `rejected` | `superseded` | `disabled`).

Every `await` is followed by a re-check of the render token and the
`disabled` state, so `clear()`, disabling, or a newer render can never be
overtaken by a stale one.

## State shared across the ESM and CJS builds

An application can load both builds of this package (its own code as ESM, a
dependency via `require`). Each build is a separate module instance, so
anything held in a module-level variable would exist twice. The profile
registry, the DOMPurify loader and the per-window DOMPurify instance cache
therefore live in one object on `globalThis` under `Symbol.for(...)`
(`src/shared-state.ts`), created lazily inside functions (never at module top
level). `SafeFragmentError` defines `Symbol.hasInstance` by shape so
`instanceof` also holds across builds. `test/package/dual-package.test.ts`
loads both built files in Node and checks all of this. Do not add other
module-level mutable state.
