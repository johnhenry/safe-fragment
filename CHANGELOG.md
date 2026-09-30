# Changelog

## Unreleased

- Added `examples/playground/` -- an interactive demo: type or paste HTML,
  or click a real attack from the test corpus, and watch it rendered two
  ways at once (raw `innerHTML` in a sandboxed iframe, where a live attack
  actually fires; and through `<safe-fragment>`, where it doesn't), plus a
  live diff and the real `SanitizationReport`. A second tab demos `ui-v1`'s
  action protocol with a styled agent-generated UI and a host application
  log. Building it caught two real bugs in the example's own helper code
  (not in `src/`): `renderProtected()` awaited the render promise before
  setting `.html`, deadlocking every render into a spurious `NO_SOURCE`
  rejection; and embedding a payload containing a literal `</script>` into
  the iframe's `srcdoc` via `JSON.stringify()` without escaping it broke
  the iframe's own controlling script (the HTML parser closes on the
  embedded `</script>` regardless of JS string context). It also surfaced
  a real gap in `SanitizationReport` itself -- see the new "Known
  limitations" entry in README.md.
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
