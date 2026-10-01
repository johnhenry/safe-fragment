# Changelog

## 0.0.0 — the pre-release hardening pass (2026-09-30)

**Provenance.** `@johnhenry/safe-fragment` is a new package: never published
under any other name, and nothing is on npm yet. `0.0.0` is the unreleased
development version; the first release waits for an independent security
review ([safe-fragment#1](https://github.com/johnhenry/safe-fragment/issues/1)).
This entry covers the initial build (`1d620aa`) and the audit-driven pass
after it. Because nothing was ever published, the breaking changes below break
nobody.

### Integration fixes from html-modules (2026-10-01)

Found while wiring `sanitizeToFragment` into [html-modules](https://github.com/johnhenry/html-modules) as its template sanitizer.

- **The DOMPurify report listed `body` and `remove` as removed elements for every input** ([#9](https://github.com/johnhenry/safe-fragment/issues/9)). They are DOMPurify's own scaffolding (the `FORCE_BODY` sentinel and the parsed `<body>` wrapper). The report now lists only genuinely removed elements, and the native diff no longer counts attributes of an element that itself went, so a benign input reports nothing on both engines and the engines agree on what the profile removes (`test/security/report-precision.test.ts`). Fixed in `081f92c`.
- **Sanitizing under `require-trusted-types-for 'script'` produced a blocked-sink violation and CSP report per call on the native path** ([#12](https://github.com/johnhenry/safe-fragment/issues/12), [#8](https://github.com/johnhenry/safe-fragment/issues/8)). The report's baseline parse used `DOMParser#parseFromString` on the raw string. It is now a permissive second `setHTML`, so no gated sink is ever called and there are zero violations in every engine (`test/integration/trusted-types-violations.test.ts`). The cost is documented in [ADR 0007](docs/adr/0007-no-gated-sink-in-the-native-report.md): the native report cannot list the engine's unconditional removals (`<script>`, `<iframe>`, `on*`, `javascript:` URLs); DOMPurify's does. Fixed in `f1e2647`.
- **Component templates** ([#11](https://github.com/johnhenry/safe-fragment/issues/11)). New built-in `component-template-v1` (`ui-v1` plus `<slot name>` and `part`/`slot`/`exportparts`; custom elements by caller-supplied prefix through `deriveProfile`, recipe in docs/profiles.md). New opt-in `idPolicy: "keep-in-shadow"` for `sanitizeToFragment` and `id-policy="keep-in-shadow"` on `<safe-fragment>`, which rejects with the new `INVALID_OPTION` unless `scope="shadow"` ([ADR 0005](docs/adr/0005-component-templates-and-id-policy.md)). `name` on clobberable elements is now namespaced like an id. To make `<slot name="title">`, `id="title"`, `exportparts="a:b"` and `data-action="cart:add"` survive identically on both engines, DOMPurify now runs with `SANITIZE_DOM: false` and `ALLOW_UNKNOWN_PROTOCOLS: true`; `enforceProfile` and `checkUrl` remain the gates, and the XSS corpus passes unchanged. **`<style>` is not supported** and stays dropped with its content: a CSS sanitizer is a separate, larger security surface ([ADR 0006](docs/adr/0006-style-element-is-a-non-goal.md)); that part of #11 stays open as a documented non-goal. Fixed in `77e5151`.
- **A git dependency installed an empty package** ([#10](https://github.com/johnhenry/safe-fragment/issues/10)). `dist/` is gitignored and nothing built it. A `prepare` script (`scripts/prepare.mjs`) now builds it for git installs and `npm ci`, skipping quietly when devDependencies are omitted; `test/package/git-install.test.ts` installs the committed HEAD as a git dependency into a scratch project and imports ESM and CJS. Fixed in `1817d79`.

- **`srcset`/`imagesrcset`/`ping` were checked only per parsed candidate.** Splitting on whitespace turned `java<TAB>script:…` into the harmless candidate `java`, but the URL parser strips the tab, so anything reading the attribute as one URL (or splitting it on commas itself, as a custom element might) got a `javascript:` URL. The whole value and each comma segment are now checked too (`test/security/url-attributes.test.ts`, "the whole value is also checked as one URL"). Found by re-probing after DOMPurify moved to `ALLOW_UNKNOWN_PROTOCOLS: true`. Fixed in `5561b98`.

### Security fixes

**Sanitizer boundary (`enforceProfile`, `checkUrl`).**

- **Reverse tabnabbing: `target` survives only as `_blank`, and `rel` is always overwritten.** Before, only an exact `target="_blank"` got `rel="noopener noreferrer"`; named targets, `_top`/`_parent`, `_BLANK` and `rel="opener"` passed through. Now `target` is dropped unless its trimmed, lowercased value is `_blank`, a kept target is normalized to `_blank`, and `rel` is overwritten, never merged. The `forceRelOnBlankTarget` profile flag is gone. Fixed in `1293499`; tests in `test/unit/enforce.test.ts`.
- **DOM clobbering: every `id` is prefixed `user-content-` and references rewritten.** `<img id="scriptUrl">` created `window.scriptUrl`; ids could shadow `document.getElementById("app")`. `href="#x"`, `for`, `aria-controls`/`labelledby`/`describedby`/`owns`, `headers`, `list` are rewritten consistently, DOMPurify's own named-props prefixing is off so ids are prefixed once, and both engines produce the same result. Fixed in `17d3384`; `test/security/dom-clobbering.test.ts`.
- **Protocol-relative and backslash URLs are judged by the document's scheme.** `checkUrl` assumed `https:` for `//host`, `\\host`, `/\host`, so on an `http:` page an https-only profile accepted a URL that would load over `http:`. It now resolves against `document.baseURI` and fails closed when the base cannot resolve them. Fixed in `ead3f55`.
- **`ui-v1`: `<button>` is forced to `type="button"`, and `data-*` is an allowlist.** The `data-*` wildcard let framework handler attributes (`data-hx-on:click`) through, and native and DOMPurify disagreed on it. Now only `allowedDataAttributes` (`data-action`) survives, passed identically to both engines, and the native config uses the current Sanitizer key names (the old ones are silently ignored by Chromium). Fixed in `3377bcc`.
- **Disallowed elements behave the same in both engines (ADR 0004).** Native dropped whole subtrees, DOMPurify unwrapped, and the old equivalence test compared one string. Raw-text/embedding/foreign containers now drop their subtree and every other disallowed element is unwrapped, in native, DOMPurify and `enforceProfile`. Both engines parse in an inert, body-context document. After enforcement the fragment is rebuilt from fresh nodes, which removes a customized built-in's hidden `is` value that attribute removal could not reach. Fixed in `a55e4ec`; `test/security/engine-equivalence.test.ts` runs every XSS and benign fixture through both engines.
- **URL checks cover every URL-valued attribute, including `srcset`.** A custom element's `src`/`href`/`data`/`ping`/... skipped `checkUrl` because the per-profile `urlAttributes` list did not name them. A fixed set of URL-valued names is now always checked; `srcset`/`imagesrcset` are parsed per the HTML algorithm and every candidate must pass. Fixed in `0a1bf0f`.
- **Relative auto-loading URLs can be blocked (`blockRelativeAutoLoadUrls`).** `<img src="/logout">` is a credentialed same-origin GET on render. `email-v1` blocks it by default; the other profiles document the risk ([#6](https://github.com/johnhenry/safe-fragment/issues/6)). Fixed in `0a1bf0f`.
- **`<example-sandbox>`: `</script>` could break out of the srcdoc, and the listener was registered before the assignment.** `<` is now escaped in the encoded string, and the message listener is registered only after `srcdoc` was assigned. It also works under Trusted Types through a named policy. Fixed in `72b4c0e`.

**`src` fetch.**

- **Redirects are refused by default, and re-validated when enabled.** The fetch used `redirect: "follow"` without re-checking the final origin. Now `redirect: "error"`; `followRedirects: true` re-validates `response.url` against the origin policy (`FETCH_REDIRECT_NOT_ALLOWED`). The timeout stays armed until the body is read, and mid-stream failures map to `FETCH_FAILED`/`FETCH_ABORTED`/`FETCH_TIMEOUT` instead of `SANITIZE_FAILED`. Fixed in `576bc8f`.

**Denial of service.**

- **`maxInputLength` (default 1,000,000) bounds sanitizer input** (`SOURCE_TOO_LARGE`); DOMPurify's quadratic removal cost is bounded, not eliminated ([#5](https://github.com/johnhenry/safe-fragment/issues/5)). Serializing the whole output to measure `outputLength` is replaced by an approximation computed during the rebuild walk. Fixed in `5de1c62`.

### Fixes and behavior changes

- **Cross-engine value parity and mid-render state, found by an audit of the audit (`34b15dc`).** The native engine kept `href=" "`, padded attribute values and `href="java script:..."` / `href="javascript&#8203;:..."` that DOMPurify trims or drops; `enforceProfile` now trims every attribute value (except `value`) and `checkUrl` also rejects a URL that becomes a disallowed scheme once whitespace, control and format characters are removed (`test/security/cross-engine-values.test.ts`, `test/unit/enforce.test.ts`). A profile, `src`, `content`, `scope` or `.html` change, or a `<template>` edit, now invalidates a render already in flight in every render mode (before, only automatic mode did, so a manual-mode `render()` could land content produced under a looser profile; `test/integration/lifecycle-state.test.ts`). README gained `## Adding a new profile`.

- **DOMPurify: one instance per window.** Re-creating it every render re-registered the Trusted Types `dompurify` policy, so a CSP `trusted-types dompurify` without `'allow-duplicates'` broke every render after the first. Added `loadDOMPurify`, `preloadSanitizer()`, an error message that says how to fix a missing import map, and an import map in every example page. Fixed in `f6b2528`.
- **Element lifecycle** (`cac4555`): `loading="lazy"` routes `src` changes and reconnects through the gate; properties set before upgrade are replayed; `clear()` and disabling cancel in-flight renders and reset `once` mode; a rejected re-render clears stale content; `.html = undefined` is `null` and non-strings reject with `INVALID_SOURCE`; switching `scope` removes the stale wrapper; `scope="shadow"` delegation uses `composedPath()`; `scope`/`loading`/`strict`/`debug` are writable and enumerated values are case-insensitive; `render()` resolves a result object (`rendered`/`rejected`/`superseded`/`disabled`); moving an element does not re-render; `pagehide` tears down fetches and observers of an element in a removed iframe; `<template>` source edits are observed; `sourceKind` is a read-only property; `safe-fragment:clear` and `safe-fragment:disabled` events; `adoptedCallback`. An explicit `render()` supersedes a queued automatic one.
- **`SanitizationReport` counts engine removals** on both engines (DOMPurify's `removed` log; a diff against an inert parse for native), where it used to under-count (`0a1bf0f`).
- **Error codes:** added `INVALID_SOURCE`, `SOURCE_TOO_LARGE`, `INVALID_PROFILE`, `SANITIZER_NOT_READY`, `FETCH_REDIRECT_NOT_ALLOWED`; removed `PARSE_FAILED` and `FETCH_METHOD_NOT_ALLOWED`, which had no honest use; the other previously unused codes (`PROFILE_MISMATCH`, `FETCH_ABORTED`, `DISABLED`, `RENDER_ABORTED`) are now emitted where they apply. README error table rewritten.
- **Dual-package hazard:** the profile registry, DOMPurify loader and instance cache live on a `Symbol.for` `globalThis` key shared by the ESM and CJS builds, and `instanceof SafeFragmentError` works across them. `test/package/dual-package.test.ts` loads both built files in Node (`0a1bf0f`, `5c4982e`).

### Breaking changes since the initial build

- `defineProfile()` is removed; built-in profiles are deeply frozen. Use `registerProfile(deriveProfile("ui-v1", { name, customElements }))`; `unregisterProfile` removes your own (`0a1bf0f`).
- `ProfileDefinition` gained `version`, `customElements` (exact tags and `prefix-*` patterns), `allowedDataAttributes` and `blockRelativeAutoLoadUrls`, and lost `allowDataAttributes`, `allowCustomElements` and `forceRelOnBlankTarget`.
- The exported `PLAIN_TEXT_V1`/`ARTICLE_V1`/`UI_V1`/`EMAIL_V1` are name strings; the internal definitions are `*_PROFILE`.
- `render()`/`refresh()` resolve a result object instead of `void`; `sourceKindNow()` is replaced by the `sourceKind` property; `getRenderedRoot()` returns `Element | null`.
- A disallowed element's text now survives (ADR 0004); a dangerous container's content never does.

### Added

- `sanitizeToFragment`, `sanitizeToFragmentSync`, `preloadSanitizer`, `registerProfile`, `unregisterProfile`, `deriveProfile`, `getSafeFragmentElementClass`, `createSafeFragmentElementClass`, and TypeScript types for the element (`SafeFragmentElement`, `SafeFragmentEventMap`, `HTMLElementTagNameMap`) (`0a1bf0f`, `cac4555`).
- Vitest projects for Chromium, WebKit and Firefox; CI installs all three and also runs the built-package tests, the examples smoke test and `npm pack --dry-run` (`887b183`). One understood Firefox divergence (`noscript` scripting-flag parse) is recorded in the equivalence test title (`46abe9e`).
- Examples numbered `01`-`04` with an `examples/README.md` index (`f079258`, `936b984`).
- `examples/04-playground/` (originally `f500b12`) and `serve.json` (`1c641a3`).
- The initial build (`1d620aa`): the sanitization pipeline, `<safe-fragment>`, `<example-sandbox>`, `plain-text-v1`, `article-v1`, `ui-v1`, a scaffolded `email-v1`, the `src` fetch capability, and the adversarial XSS corpus.

### Tests

The initial suite had 150 tests in 9 files, run in Chromium only. It is now 497 tests per browser in 21 files (plus 4 example smoke tests and 4 Node tests of the built packages), run in Chromium, WebKit and Firefox in CI. New: a benign-content corpus, corpus-wide engine equivalence, clobbering, URL-attribute and srcset, Trusted Types (DOMPurify and sandbox), lifecycle, public API, input-limit and dual-package suites. Corpus fixtures also assert that benign content survives.

### Documentation

README re-organized (Install with import-map guidance, Security model after the API sections, Family naming mechanisms); security model, profiles and architecture rewritten for the new pipeline; ADR 0004 added; AGENTS.md trimmed and its verification loop matched to CI; drift fixed (test counts, a comment naming a nonexistent file, the relative-URL comment in `profile.ts`, the architecture example list, the `ui-v1` button claim, `npx http-server` vs `npx serve`, the "supersession-safe" and "Solid" claims). Remaining gaps are issues [#1](https://github.com/johnhenry/safe-fragment/issues/1)-[#8](https://github.com/johnhenry/safe-fragment/issues/8).

### Housekeeping

- `engines.node` moved to `devEngines` (consumers are browsers); `.nvmrc` is `26`; `./package.json` is exported.
- **`dompurify` is pinned to an exact version (`3.4.16`)** because profile output stability depends on it. Bumping it is a deliberate change: read its release notes, run all three browsers, the XSS and benign corpora and the equivalence test, and record the bump here.
