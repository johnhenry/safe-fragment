# Changelog

## Unreleased

- Added `serve.json` (`{"cleanUrls": false}`) -- without it, `npx serve .`
  (the exact command the examples' own instructions suggest) redirects
  away the trailing path segment and breaks the examples' relative
  `./main.mjs` imports. Found by actually opening `examples/article-viewer/`
  through a real static server rather than only via the automated
  Vitest-Browser-Mode example smoke test, which doesn't go through a real
  server navigation and so never hit this.
- Initial build: `plain-text-v1` and `article-v1` sanitization pipeline
  (native Sanitizer API + DOMPurify fallback, shared `enforceProfile`
  allowlist pass), the adversarial XSS regression corpus, the
  `<safe-fragment>` custom element (source precedence, render modes,
  light/shadow scope, five custom events, `SanitizationReport`), `ui-v1`
  (custom-element allowlisting + `data-action` delegation), the `src`
  remote-fetch capability model, `<example-sandbox>`, and a scaffolded
  `email-v1` profile. Not yet published to npm -- `version` intentionally
  stays at `0.0.0` until a human review pass. See README "Known
  limitations" for what is solid vs. scaffolded.
