# ADR 0007: No Trusted-Types-gated sink is ever touched, even for the report

## Status

Accepted. Supersedes the `DOMParser` baseline of the native report described in safe-fragment#8; resolves safe-fragment#12.

## Context

The native Sanitizer API reports nothing about what it removed, so the
`SanitizationReport` of the native path was built by parsing the input a
second time and diffing the element/attribute inventories against the
engine's output. The second parse used `new DOMParser().parseFromString(html)`.

Under `Content-Security-Policy: require-trusted-types-for 'script'`,
`parseFromString` is a gated sink: passing it a string is a blocked action, a
`securitypolicyviolation` event and (with `report-uri`/`report-to`) a CSP
report, **on every sanitization, including benign input**. The code caught the
`TypeError` and fell back to a second `setHTML`, so the output was right and
the report degraded, but a page that treats violation reports as alerts was
alerted for every template (safe-fragment#12).

There is no way to find out whether Trusted Types is enforced without
triggering the violation: no API reports enforcement, and every probe
(`innerHTML = ""`, `createPolicy`, `parseFromString`) is itself reported.
Creating our own policy to wrap the string would violate any CSP whose
`trusted-types` list does not name it.

## Decision

The library never calls a Trusted-Types-gated sink with a string, anywhere.
The native report's baseline is a second `setHTML` with a permissive,
blocklist-free config in the same inert document (`setHTML` is not gated).

## Consequences

- Sanitizing under an enforcing CSP produces zero violations in every engine;
  `test/integration/trusted-types-violations.test.ts` listens for
  `securitypolicyviolation` on an enforcing frame and asserts none.
- Behavior no longer depends on whether Trusted Types is enforced.
- The native report lists what **our config** removed (elements outside the
  profile, dangerous containers, non-allowlisted attributes) but not what the
  engine removes unconditionally whatever the config says: `<script>`,
  `<iframe>`, `on*` handlers, `javascript:` URLs. Every safe `setHTML` strips
  these before we can look, and the only way to see them is a gated parse.
  The DOMPurify path's report does list them (its `removed` log). The two
  engines therefore agree on benign input (empty) and on everything the
  profile removes, and differ only in these engine-baseline removals.
  `enforceProfile` still removes anything either engine misses, so the
  security outcome is unaffected; only the diagnostic is less complete.
- This closes safe-fragment#8 as a documented limitation.
