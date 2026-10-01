# Agent playbook

`@johnhenry/safe-fragment` -- framework-agnostic Web Components that render untrusted HTML-like content into live DOM only through an explicit, versioned security-profile allowlist. Single package, Node >= 26 for the toolchain, TypeScript built with `tsup` (ESM + CJS + `.d.ts`), tested with **Vitest Browser Mode in real Chromium, WebKit and Firefox** (Playwright) -- never jsdom. This is security-critical: read docs/security-model.md and docs/adr/ before touching `src/sanitize/` or `src/policy/`.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

Same order as CI (`.github/workflows/ci.yml`); match it locally.

1. `npm run lint`
2. `npm run typecheck` (covers `src/`, `test/`, `examples/`)
3. `npm run build`
4. `npm test` -- all three browsers (Firefox may not launch in a sandbox: `SF_BROWSERS=chromium,webkit npm test`, and say so). Suites that can skip must show their skips with a reason: the native-vs-DOMPurify equivalence suite skips (loudly, in the title) where no `setHTML` exists. 596 tests in 24 files on Chromium at last count (WebKit: 413 run + 62 loud skips of the native-only suites); the equivalence/benign/XSS corpora run per engine.
5. `npm run test:dist` (Node, 5 tests: ESM + CJS builds load together and share state; the committed HEAD installs as a git dependency into a scratch project with a working dist, needs network) and `npm run examples` (built examples smoke test)
6. `npm pack --dry-run` -- read the file list, not the exit code (`dist/index.d.ts` for ESM, `dist/index.d.cts` for CJS; `exports` must point each condition at its own).
7. A genuinely fresh clone: `git clone . /tmp/safe-fragment-verifyN && cd $_ && npm ci && npm run build && SF_BROWSERS=chromium,webkit npm test`.
8. Commit, push, close the issue with a comment naming the SHA.

## Repo-specific gotchas

- **`fileParallelism: false` is load-bearing.** Concurrent Playwright contexts flaked ("Browser connection was closed", ~1 in 5 runs). Re-verify with repeated runs if you touch it.
- **Flaky-test triage (2026-10-01).** Two different things hide behind "flaky": (1) *Timing flakes in tests*: a fixed `settle()` sleep (20-30 ms) before asserting on a render raced WebKit's cold first render and failed ~45% of Chromium+WebKit runs (`safe-fragment-element.test.ts` "prefers .html property...", `lifecycle.test.ts` "replays properties set before the element was upgraded"; assertion errors, `null`/`undefined` root). Fixed with event-based waits (`waitForEvent`/`nextEvent` on `safe-fragment:render` / `:disabled`, attached BEFORE the trigger, with a timeout that fails loudly). Use `settle()` only for negative assertions ("nothing rendered", "no second render"). Do not add new fixed-sleep waits for a positive result. (2) *Infrastructure disconnects*: "Browser connection was closed while running tests" is raised by `@vitest/browser` when the page's WebSocket closes (browser crash/kill, resource pressure); it is not a test failure and not related to `connectTimeout` (that governs only the initial "Failed to connect to the browser session" wait, default 60 s). With `fileParallelism: false` it did not reproduce in ~25 local Chromium+WebKit runs, so no config was added: no `retry` (a retry would also mask real failures, and never use blanket retries on `test/security/`), no extra launch args, no `connectTimeout` change. If it recurs in CI, first check the run log for a browser crash and `VITEST_BROWSER_HEARTBEAT_INTERVAL` (default 15 s, terminates after 2 missed pings), and re-run the whole job; a *test* that fails with an assertion is never infrastructure.
- **`enforceProfile` is the security boundary, not either engine.** Don't fix a bypass by tightening an engine config; fix it in `src/sanitize/enforce.ts` (or `checkUrl`) with a regression test in `test/security/` or `test/unit/enforce.test.ts`.
- **Disallowed elements: dangerous containers drop their subtree, everything else unwraps (ADR 0004).** The list is `src/sanitize/dangerous.ts`, shared by native `removeElements`, DOMPurify `FORBID_CONTENTS` and `enforceProfile`. `KEEP_CONTENT: false` silently deletes ALL text nodes with an explicit `ALLOWED_TAGS` (a shipped bug, ADR 0002): keep it `true`.
- **Native config must use the current Sanitizer key names** (`removeElements`, `attributes`, `comments`, `dataAttributes`); the legacy `allowComments`/`allowCustomElements`/`allowUnknownMarkup` are silently ignored by Chromium. The native parse runs in a `<div>` of an inert document (a live-document or `<template>` context diverges from DOMPurify and can start loads early).
- **`checkUrl` resolves authority-bearing relative URLs (`//host`, `\\host`) against the document's base**, with a fixed HTTPS probe only to tell "no authority" from "has authority". Never classify them `"relative"`; fail closed on unusable bases. Re-run `test/unit/url-policy.test.ts`'s protocol-relative cases after any change.
- **Every surviving `id` gets `user-content-` once**, with references rewritten, unless the caller opts in to `idPolicy: "keep-in-shadow"` (ADR 0005; `<safe-fragment>` rejects it without `scope="shadow"`). A `name` on clobberable elements is prefixed under every policy. DOMPurify `SANITIZE_NAMED_PROPS` and `SANITIZE_DOM` stay `false` (else double prefix / `<slot name="title">` and `id="title"` dropped on one engine only) and `ALLOW_UNKNOWN_PROTOCOLS` stays `true` (else `exportparts="a:b"`, `data-action="cart:add"` dropped on one engine only); `enforceProfile`/`checkUrl` are the gates. After enforcement the fragment is **rebuilt from fresh nodes** (`rebuild.ts`): a customized built-in's hidden `is` value survives attribute removal.
- **One DOMPurify instance per window** (WeakMap in shared state): re-creating it re-registers the Trusted Types `dompurify` policy and breaks CSPs without `'allow-duplicates'`. **`dompurify` is pinned to an exact version**: profile output stability depends on it. Bump deliberately (read its release notes, run all three browsers, equivalence + XSS corpora, note it in CHANGELOG).
- **State shared by ESM and CJS builds lives on `globalThis` under `Symbol.for` (`src/shared-state.ts`).** No other module-level mutable state; `SafeFragmentError` uses `Symbol.hasInstance`.
- **`#scheduleRender()` re-checks mode/disabled/connected inside its microtask** (`create(); append(); configure()` must honor `render-mode="manual"`), and every `await` in `render()` re-checks the token and `disabled`. An explicit `render()` supersedes a queued automatic one.
- **Never call a Trusted-Types-gated sink with a string, even for the report** (`DOMParser#parseFromString`, `innerHTML`, `createContextualFragment`, `setHTMLUnsafe`): enforcement cannot be detected without a violation and CSP report (ADR 0007, #12). `test/integration/trusted-types-violations.test.ts` listens for `securitypolicyviolation`. Consequence: the native report cannot list the engine's unconditional removals (`script`, `iframe`, `on*`).
- **`dist/` is built by the `prepare` script (`scripts/prepare.mjs`)** so a git dependency installs a working package; it skips quietly when tsup is absent (`--omit=dev`). Changing it? Re-run `test/package/git-install.test.ts`, and after pushing install `git+https://github.com/johnhenry/safe-fragment#<sha>` into a scratch project.
- **`<style>` is a non-goal** (ADR 0006): do not add CSS handling without a CSSOM-based design, an adversarial corpus and independent review.
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

The publish workflow's gate is whatever `gate-commands` it passes to the shared `johnhenry/workflows/.github/workflows/npm-publish.yml@v1` (that workflow has no gate of its own: install, your gate, then an `npm view` pre-flight and `npm publish --provenance --access public`). Keep `publish.yml`'s list identical to `ci.yml`'s: lint, typecheck, build, `npm test` (all three browsers), `test:dist`, `examples`, `npm pack --dry-run`. `npm publish` also runs `prepublishOnly` (lint, typecheck, test, build) and `prepare` (rebuild; harmless with `npm ci`), so the suite runs twice in the publish job.

### First release checklist (0.1.0 or 1.0.0; nothing is on npm yet)

1. **Security review gate:** safe-fragment#1 (independent security review) is closed with a written sign-off, and its findings are fixed with regression tests. A human says go in chat; do not infer it.
2. `README` "What still needs human review" and "Known limitations" are current; `SECURITY.md` has a working reporting channel.
3. Pick the version (PR bumps `version` from `0.0.0`); `CHANGELOG.md` has a dated entry for it citing commits.
4. `repository.url` is `git+https://github.com/johnhenry/safe-fragment.git` (npm provenance verifies it against the workflow's repo), `homepage`, `exports` (each condition has its own `.d.ts`/`.d.cts`), `files` and the exact `dompurify` pin are right; `devEngines` is Node >= 26.
5. Full loop green on `main` in CI (all three browsers), including the fresh-clone check.
6. `npm pack --dry-run` and `npm publish --dry-run` (locally, `SF_BROWSERS=chromium,webkit`): exactly `CHANGELOG.md`, `LICENSE`, `README.md`, `package.json`, and `dist/index.{js,cjs,d.ts,d.cts}` plus maps; no `test/`, `.env`, scratch or `.vitest/` files.
7. The repo has an `NPM_TOKEN` Actions secret (set by the owner; never read or print it) and `id-token: write` is declared in `publish.yml` (it is). First publish of a scoped package needs `--access public` (set in `publishConfig` and by the shared workflow). The `npm view` guard treats the registry's 404 for a never-published package as "not published yet" and proceeds.
8. Only then `gh release create v<version>` (tag `v<version>` must match `package.json`). Watch the Publish run to green, then verify `npm view @johnhenry/safe-fragment` and the provenance badge, and install it into a scratch project.
