# Agent playbook

`@johnhenry/safe-fragment` -- framework-agnostic Web Components for
rendering untrusted HTML-like content into live DOM only after an
explicit, versioned security-profile allowlist. Single package, Node.js
26 or newer, TypeScript with a real build step (`tsup`, dual ESM/CJS +
`.d.ts`), tested with **Vitest Browser Mode against real headless
Chromium** (Playwright provider) -- not jsdom, not plain `node:test`.
This is a security-critical library: read docs/security-model.md and the
three ADRs in docs/adr/ before touching `src/sanitize/` or `src/policy/`.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

1. `npm run lint` -- ESLint.
2. `npm run typecheck` -- `tsc --noEmit` (covers `src/`, `test/`, and
   `examples/`).
3. `npm test` -- Vitest, real Chromium. Currently 150 tests across 9
   files, including a 58-case adversarial XSS corpus run against both
   sanitization engines. Any new sanitizer-relevant behavior needs a test
   here, not just a manual check.
4. `npm run build && npm pack --dry-run` -- reads `dist/`, `README.md`,
   `LICENSE`, `CHANGELOG.md` per the `files` field; read the actual file
   list, not just the exit code (`dist/index.d.ts` for ESM,
   `dist/index.d.cts` for CJS -- tsup emits both, and `package.json`'s
   `exports` map must point each `require`/`import` condition at its own
   `.d.cts`/`.d.ts`, not share one).
5. A genuinely fresh clone:
   `git clone . /tmp/safe-fragment-verifyN && cd $_ && npm ci && npm run build && npm test`.
6. Commit, push, close the issue with a comment naming the commit SHA.

## Repo-specific gotchas

- **`fileParallelism: false` in `vitest.config.ts` is load-bearing, not
  incidental.** Multiple concurrent Playwright browser contexts were
  observed occasionally producing a "Browser connection was closed"
  flake (roughly 1-in-5 runs) under this sandbox's resource constraints.
  Serializing test files onto one browser page fixed it across 10+
  consecutive runs. If you re-enable parallelism, re-verify stability
  with several repeated `npx vitest run` invocations before trusting it.
- **`DOMPurify`'s `KEEP_CONTENT: false` silently deletes ALL text nodes,
  not just disallowed-element content**, when combined with an explicit
  custom `ALLOWED_TAGS` list (it also gates whether `"#text"` is
  implicitly added to that list). This shipped as a real bug once and was
  caught by the cross-engine equivalence test in
  `test/security/xss-corpus.test.ts`. `KEEP_CONTENT: true` is correct
  here -- see `docs/adr/0002-native-sanitizer-with-dompurify-fallback.md`
  for the full incident writeup before changing this flag again.
- **`enforceProfile` (`src/sanitize/enforce.ts`) is the actual security
  boundary, not either sanitization engine.** Both engines' configs
  (`src/sanitize/config.ts`) only need to be "roughly right" -- it is
  `enforceProfile`'s walk that authoritatively decides what survives.
  Don't "fix" a sanitizer-bypass-shaped bug by tightening an engine
  config alone; fix (and add a regression test for) `enforceProfile`.
- **`checkUrl` (`src/policy/url.ts`) resolves relative URLs against a
  fixed HTTPS probe base and compares both scheme AND host to distinguish
  a genuine same-document relative reference from a protocol-relative
  `//host/path` URL** (which inherits only the _scheme_, not the host,
  from whatever it resolves against, and must never be classified as
  `"relative"`). If you touch this function, re-run
  `test/unit/url-policy.test.ts`'s protocol-relative cases specifically --
  they previously failed silently in a way that would have let
  `//evil.example/x` through as "relative" under a `["relative"]`-only
  allowlist.
- **`#scheduleRender()` in `src/render/safe-fragment-element.ts` must
  re-check `renderMode` inside its `queueMicrotask` callback, not only at
  scheduling time.** `connectedCallback` can queue a render before
  `render-mode`/`profile` attributes are set imperatively (a common
  `create(); append(); configure()` pattern, exactly what the integration
  tests do) -- without the recheck, an element configured as
  `render-mode="manual"` immediately after being appended would still
  auto-render once. See the comment at that call site before changing it.
- **Never call any unsafe DOM sink (`innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `setHTMLUnsafe`) on a string that came from
  outside `src/sanitize/`.** The only exceptions in the whole codebase are
  (a) test helpers operating on hardcoded literal test fixtures (never
  runtime/attacker data), and (b) `<example-sandbox>`'s `iframe.srcdoc`,
  which is documented, application-trusted, executable-by-design content
  in a sandboxed iframe -- not `<safe-fragment>`'s code path at all.
- **Never dereference `window`/`document`/`HTMLElement`/`customElements`
  at module top level anywhere under `src/`.** This package must stay
  importable in Node/SSR. Every browser-global access lives inside a
  function body (see `src/platform/environment.ts` and the
  `create*ElementClass()` factory pattern in docs/architecture.md).
- **`npx serve .` (the exact command the examples' own HTML tells you to
  run) breaks module resolution unless `serve.json`'s `cleanUrls: false`
  is present at the repo root.** `serve`'s default "clean URLs" behavior
  redirects `/examples/article-viewer/index.html` → `.../index` →
  `.../article-viewer` (no trailing slash), which shifts the browser's
  relative-URL base up one directory, so `./main.mjs` 404s as
  `/examples/main.mjs`. `npm run examples`'s automated Vitest Browser Mode
  check never hits this (it imports the example module directly, not
  through a real static-file-server navigation), so this only surfaces
  when a human actually opens an example in a browser via the README's
  own suggested command -- confirmed by doing exactly that. Don't remove
  `serve.json` or "simplify" it away.

## Definition of done

A change is done when all of the following hold, not just when tests pass:

- A regression test exists for any bug fixed -- a sanitizer-adjacent bug
  without a `test/security/` or `test/unit/enforce.test.ts` case that
  would have caught it is not actually fixed, it is fixed _this time_.
- Anything the feature does **not** do is stated in the README's
  "Known limitations" section (or the relevant profile's doc comment),
  not only in an issue comment.
- `CHANGELOG.md` has an entry.
- If the change touches `src/sanitize/` or `src/policy/`, the "What still
  needs human review" list in the README is re-checked for whether it
  needs an update.

## Non-goals

- A "trusted"/"unsafe"/"allowScripts" bypass flag anywhere in the public
  API. If a fully-trusted fast path is ever genuinely needed, it is a
  separate, explicitly-documented, application-level API -- not an
  addition to this package. See
  `docs/adr/0001-html-as-data-not-code.md`.
- Treating Shadow DOM (`scope="shadow"`) as an isolation/security
  mechanism, or adding a `mode: "closed"` shadow option on the theory
  that it would add safety. See
  `docs/adr/0003-shadow-dom-is-not-sandboxing.md`.
- Regex-based HTML or URL-scheme sanitization anywhere. Use the `URL`
  parser (`src/policy/url.ts`) or real DOM APIs
  (`TreeWalker`/`querySelectorAll`/attribute methods), never a regex
  against an HTML or attribute-value string.

## Releases

Bump `version` in `package.json` in a PR, add the `CHANGELOG.md` entry,
merge, then `gh release create v<version>` -- the release event triggers
`.github/workflows/publish.yml`, which is idempotent (skips if the
version is already on npm). **Do not cut the first release without an
explicit human go-ahead** -- this package has not yet had the security
review called for in the README's "What still needs human review"
section.
