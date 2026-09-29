# Changelog

## Unreleased

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
