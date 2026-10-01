# Security policy

`@johnhenry/safe-fragment` is a security-focused library: its entire
purpose is safely rendering untrusted HTML-like content. Reports of
sanitizer bypasses, XSS, or other security issues are taken seriously and
prioritized over feature work.

## Status

This package has **not yet been published to npm** and has **not yet had
an independent security review**. `version` is intentionally pinned at
`0.0.0` and no GitHub release has been cut. Treat anything built on top of
it today as pre-review, unreviewed code -- see the README's "Known
limitations" and "What still needs human review" sections before relying
on it for real user content.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a suspected security
vulnerability (including a sanitizer bypass -- an input that survives
`enforceProfile` and results in script execution, or an `<example-sandbox>`
escape). Instead:

1. Use GitHub's private vulnerability reporting for this repository
   (Security tab -> "Report a vulnerability"), or
2. Email the maintainer directly at the address listed in `package.json`'s
   `author` field.

Please include:

- The profile used (`article-v1`, `ui-v1`, etc.) and the exact input
  markup that reproduces the issue.
- Whether the native Sanitizer API path or the DOMPurify fallback path was
  exercised (`SanitizationReport.engine`), and the browser/version if
  relevant.
- What you expected to happen vs. what actually happened.

A reproduction that fits the shape of `test/fixtures/xss-corpus.ts`
(a `{ profile, input, forbiddenSubstrings }` entry) is especially useful
and will likely become a permanent regression test either way.

## Scope

In scope:

- Any input that causes `<safe-fragment>` (any profile) to execute
  attacker-controlled script, load an attacker-controlled resource via a
  disallowed URL scheme, or otherwise violate the guarantees listed in the
  README's "Security model" section.
- Any way to reach an unsafe DOM sink (`innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `setHTMLUnsafe`) with unsanitized input from
  within this package's own code.
- Any way for `<example-sandbox>`'s iframe to escape its sandbox
  attributes or access the parent page's document/cookies/storage despite
  the lack of `allow-same-origin`.

Explicitly **out of scope** (see docs/security-model.md "What this
package does not protect against"): content-level phishing that doesn't
involve code execution, CSS-based attacks that rely on the _host
application's own_ stylesheet selectors, and anything about
`<example-sandbox>`'s deliberately-unsandboxed script execution itself
(that component's whole purpose is running real code -- see its module
doc comment and ADR 0001).

## Supported versions

Pre-1.0: only the latest published version (once publishing begins) is
supported. There is no long-term-support branch yet.
