# Agent playbook

`@johnhenry/safe-fragment` -- framework-agnostic Web Components that render untrusted HTML-like content into live DOM only through an explicit, versioned security-profile allowlist. Single package, Node >= 26 for the toolchain, TypeScript built with `tsup` (ESM + CJS + `.d.ts`), tested with **Vitest Browser Mode in real Chromium, WebKit and Firefox** (Playwright) -- never jsdom. This is security-critical: read docs/security-model.md and docs/adr/ before touching `src/sanitize/` or `src/policy/`.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

Same order as CI (`.github/workflows/ci.yml`); match it locally.

1. `npm run lint`
2. `npm run typecheck` (covers `src/`, `test/`, `examples/`)
3. `npm run build`
4. `npm test` -- all three browsers (Firefox may not launch in a sandbox: `SF_BROWSERS=chromium,webkit npm test`, and say so). Suites that can skip must show their skips with a reason: the native-vs-DOMPurify equivalence suite skips (loudly, in the title) where no `setHTML` exists. 497 tests per browser in 21 files at last count; the equivalence/benign/XSS corpora run per engine.
5. `npm run test:dist` (Node: ESM + CJS builds load together, share state) and `npm run examples` (built examples smoke test)
6. `npm pack --dry-run` -- read the file list, not the exit code (`dist/index.d.ts` for ESM, `dist/index.d.cts` for CJS; `exports` must point each condition at its own).
7. A genuinely fresh clone: `git clone . /tmp/safe-fragment-verifyN && cd $_ && npm ci && npm run build && SF_BROWSERS=chromium,webkit npm test`.
8. Commit, push, close the issue with a comment naming the SHA.

## Repo-specific gotchas

- **`fileParallelism: false` is load-bearing.** Concurrent Playwright contexts flaked ("Browser connection was closed", ~1 in 5 runs). Re-verify with repeated runs if you touch it.
- **`enforceProfile` is the security boundary, not either engine.** Don't fix a bypass by tightening an engine config; fix it in `src/sanitize/enforce.ts` (or `checkUrl`) with a regression test in `test/security/` or `test/unit/enforce.test.ts`.
- **Disallowed elements: dangerous containers drop their subtree, everything else unwraps (ADR 0004).** The list is `src/sanitize/dangerous.ts`, shared by native `removeElements`, DOMPurify `FORBID_CONTENTS` and `enforceProfile`. `KEEP_CONTENT: false` silently deletes ALL text nodes with an explicit `ALLOWED_TAGS` (a shipped bug, ADR 0002): keep it `true`.
- **Native config must use the current Sanitizer key names** (`removeElements`, `attributes`, `comments`, `dataAttributes`); the legacy `allowComments`/`allowCustomElements`/`allowUnknownMarkup` are silently ignored by Chromium. The native parse runs in a `<div>` of an inert document (a live-document or `<template>` context diverges from DOMPurify and can start loads early).
- **`checkUrl` resolves authority-bearing relative URLs (`//host`, `\\host`) against the document's base**, with a fixed HTTPS probe only to tell "no authority" from "has authority". Never classify them `"relative"`; fail closed on unusable bases. Re-run `test/unit/url-policy.test.ts`'s protocol-relative cases after any change.
- **Every surviving `id` gets `user-content-` once**, with references rewritten; DOMPurify `SANITIZE_NAMED_PROPS` stays `false` (else double prefix). After enforcement the fragment is **rebuilt from fresh nodes** (`rebuild.ts`): a customized built-in's hidden `is` value survives attribute removal.
- **One DOMPurify instance per window** (WeakMap in shared state): re-creating it re-registers the Trusted Types `dompurify` policy and breaks CSPs without `'allow-duplicates'`. **`dompurify` is pinned to an exact version**: profile output stability depends on it. Bump deliberately (read its release notes, run all three browsers, equivalence + XSS corpora, note it in CHANGELOG).
- **State shared by ESM and CJS builds lives on `globalThis` under `Symbol.for` (`src/shared-state.ts`).** No other module-level mutable state; `SafeFragmentError` uses `Symbol.hasInstance`.
- **`#scheduleRender()` re-checks mode/disabled/connected inside its microtask** (`create(); append(); configure()` must honor `render-mode="manual"`), and every `await` in `render()` re-checks the token and `disabled`. An explicit `render()` supersedes a queued automatic one.
- **Never call an unsafe sink (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTMLUnsafe`) on a string from outside `src/sanitize/`.** Exceptions: test helpers on literal fixtures, and `<example-sandbox>`'s `srcdoc` (application-authored code, sandboxed iframe, optional Trusted Types policy `safe-fragment-sandbox`).
- **Never touch `window`/`document`/`HTMLElement`/`customElements` at module top level under `src/`**; the package must import in Node/SSR (see `src/platform/environment.ts`, the `create*ElementClass()` factories).
- **The examples import `dompurify` via a per-page import map** (Safari has no `setHTML`); `npx serve .` needs `serve.json`'s `cleanUrls: false` or `./main.mjs` 404s. Don't remove either.
- **Cross-engine corpus tests**: add benign fixtures (`test/fixtures/benign-corpus.ts`) alongside XSS ones; a `knownDivergence` entry needs a real, explained reason.

## Definition of done

- A regression test exists for any bug fixed (sanitizer-adjacent: in `test/security/` or `test/unit/enforce.test.ts`).
- Anything the feature does **not** do is in the README's "Known limitations" (with a `safe-fragment#N` issue) or the profile's doc comment.
- `CHANGELOG.md` has an entry citing the commit.
- If `src/sanitize/` or `src/policy/` changed, re-check the README's "What still needs human review" list.

## Non-goals

- A "trusted"/"unsafe"/"allowScripts" bypass flag anywhere in the public API (ADR 0001).
- Treating `scope="shadow"` as isolation, or a `mode: "closed"` shadow option (ADR 0003).
- Regex-based HTML or URL sanitization. Use the `URL` parser or DOM APIs (`TreeWalker`/`querySelectorAll`/attribute methods).

## Releases

Bump `version` in a PR, add the `CHANGELOG.md` entry, merge, then `gh release create v<version>`; the release triggers `.github/workflows/publish.yml` (idempotent). **Do not cut the first release without an explicit human go-ahead**: it needs the independent security review (safe-fragment#1).
