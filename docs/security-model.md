# Security model

This document is the detailed companion to the README's "Security model"
section. Read that first for the summary; this is the "how, exactly" for
each guarantee.

See also: [ADR 0001](adr/0001-html-as-data-not-code.md) (why untrusted
input is always treated as data, never assigned via `innerHTML`-family
sinks), [ADR 0002](adr/0002-native-sanitizer-with-dompurify-fallback.md)
(the two-engine-plus-shared-enforcement sanitization design),
[ADR 0003](adr/0003-shadow-dom-is-not-sandboxing.md) (why `scope="shadow"`
is styling encapsulation, not isolation) and
[ADR 0004](adr/0004-disallowed-elements-unwrap-or-drop.md) (what happens to
a disallowed element's content, identically in both engines) and
[ADR 0005](adr/0005-component-templates-and-id-policy.md) (`component-template-v1`, `idPolicy: "keep-in-shadow"`),
[ADR 0006](adr/0006-style-element-is-a-non-goal.md) (why `<style>` is not supported) and
[ADR 0007](adr/0007-no-gated-sink-in-the-native-report.md) (no Trusted-Types-gated sink, even for the report),
[ADR 0008](adr/0008-mutation-xss-fuzzer-findings.md) (what the mutation-XSS fuzzer found and fixed),
[ADR 0009](adr/0009-email-v1.md) (`email-v1`: `cid:`, Office markup, layout attributes),
[ADR 0010](adr/0010-svg-and-mathml-opt-in.md) (opt-in static SVG and presentation MathML) and
[ADR 0011](adr/0011-class-allowlist.md) (`class` is an allowlist),
[ADR 0012](adr/0012-parse-realm-iframe-for-csp.md) (the parse realm: a hidden iframe on Chromium so parsing reports no CSP violations). The reviewer packet,
[docs/review/](review/README.md), maps all of it to code.

## The pipeline, precisely

```
string ─▶ size check ─▶ engine (native setHTML | DOMPurify) ─▶ enforceProfile() ─▶ rebuild ─▶ DocumentFragment
                        "inert, roughly to profile,           "the actual           "fresh nodes:  (detached; not yet
                         in an inert document"                 allowlist"             no hidden state" inserted)
```

The same pipeline backs `<safe-fragment>` and the public
`sanitizeToFragment()`/`sanitizeToFragmentSync()`; the element is one consumer
of it.

1. **Source resolution.** `<safe-fragment>` picks exactly one markup
   source per the documented precedence (`.html` property > `<template>`
   child > `src` > legacy `content` attribute). In `strict` mode, more
   than one present source is a hard `AMBIGUOUS_SOURCE` rejection instead
   of silently picking by precedence. A source that is not a string is an
   `INVALID_SOURCE` rejection (never rendered as `[object Object]`).
2. **Profile resolution.** The `profile` attribute/property must name a
   registered profile (a built-in, or one added with `registerProfile`). An
   unknown or missing profile is a hard `UNKNOWN_PROFILE` rejection -- there
   is no implicit default profile, on purpose: rendering _something_ under a
   wrong-by-accident profile is worse than rendering nothing.
3. **`before-render`.** A cancelable event fires once the source and profile
   have validated, before any fetch or parse. An application can inspect
   `detail.profile`/`detail.sourceKind` and veto the render with
   `preventDefault()` (the render then resolves `rejected` with
   `RENDER_ABORTED`; existing content is left alone). Invalid configurations
   reject without firing it.
4. **Fetch** (`src` only; see "The `src` fetch" below).
5. **Size check.** The string must be at most `maxInputLength` UTF-16 code
   units (default 1,000,000), else `SOURCE_TOO_LARGE`. See "Cost and denial of
   service".
6. **Sanitization** (`src/sanitize/index.ts`):
   - `mode: "text"` profiles (`plain-text-v1`) skip this whole pipeline:
     the string becomes a single `Text` node via `document.createTextNode`,
     and no HTML parser is ever invoked on it.
   - `mode: "html"` profiles feature-detect the native Sanitizer API
     (`Element.prototype.setHTML`) and use it when available; otherwise
     DOMPurify, configured with an explicit allowlist derived from the
     profile (never DOMPurify's own defaults). One DOMPurify instance is
     created per window and reused (so a Trusted Types `dompurify` policy is
     registered once).
   - Both engines parse inside an **inert document** (no browsing context,
     so nothing loads or runs; on Chromium made by a hidden `about:blank` iframe's
     `DOMImplementation`, [ADR 0012](adr/0012-parse-realm-iframe-for-csp.md)), in `<body>`/`<div>` context, standards mode, so the same
     input yields the same tree in both (DOMPurify is fed `<!DOCTYPE html><xmp></xmp>` before the
     input: the doctype is standards mode, `<xmp>` starts the body and stops a `<frameset>` from
     replacing it, [ADR 0008](adr/0008-mutation-xss-fuzzer-findings.md)). The native engine runs in a
     blocklist configuration for elements (the dangerous containers) and an
     allowlist for attributes; DOMPurify runs with `KEEP_CONTENT: true` and
     `FORBID_CONTENTS` set to the same dangerous-container list. Neither
     config needs to be perfect: step 7 is the boundary.
   - What the engine removed is reported: DOMPurify via its `removed` log
     (minus its own scaffolding: the `<remove>` sentinel and the `<body>`
     wrapper, so a benign input reports nothing); the native engine via a diff
     of a permissive second `setHTML` in the same inert document against its
     output. The native diff cannot see the engine's unconditional baseline
     removals (`<script>`, `<iframe>`, `on*`, `javascript:` URLs); see
     [ADR 0007](adr/0007-no-gated-sink-in-the-native-report.md).
7. **`enforceProfile()`** (`src/sanitize/enforce.ts`) -- the authoritative
   allowlist pass, run identically regardless of which engine produced the
   fragment:
   - Strips comments and walks every element.
   - **Disallowed elements, one behavior** ([ADR 0004](adr/0004-disallowed-elements-unwrap-or-drop.md)):
     any element outside the HTML namespace (SVG/MathML descendants) and any
     raw-text/embedding container (`script`, `style`, `template`, `noscript`,
     `iframe`, `noembed`, `noframes`, `xmp`, `textarea`, `title`, `select`,
     `object`, `embed`, `svg`, `math`, ...) is **dropped with its whole
     subtree**; every other element the profile does not allow (unknown,
     presentational like `marquee`/`font`, table cells in a profile without
     tables, unregistered custom elements) is **unwrapped**: the element goes,
     its text and allowed descendants stay.
   - For elements that survive, removes any attribute not on that element's
     allowed list (custom elements: the matching entry's list), with hard
     exceptions that apply regardless of profile configuration:
     - Any attribute matching `on*` (case-insensitive), plus a small
       explicit denylist (`formaction`, `srcdoc`, `action`, `xlink:href`), is
       **always** removed, even if a profile mistakenly lists it. A backstop,
       not the primary defense.
     - `style` is removed unless the profile's `allowStyleAttribute` is
       `true`; `registerProfile` refuses to register such a profile, and no
       built-in sets it.
     - `data-*` attributes are kept only when named in the profile's
       `allowedDataAttributes` (`ui-v1`: `data-action` only; no wildcard) or
       in the element's own attribute list.
   - **Attribute values that are markup to some parser are dropped** (any attribute, any
     profile): `-->`, `--!>`, `]>`, `/>` or the end tag of a raw-text element
     (`</style`, `</script`, `</title`, `</textarea`, `</noscript`, ...) in a value would become
     markup if a host serialized and re-parsed the output in a context that does not escape
     `<`/`>` in attributes. **A value that starts with `data:` or a word ending in `script:`**
     (`javascript:`, `vbscript:`) is dropped from every non-URL attribute too
     ([ADR 0008](adr/0008-mutation-xss-fuzzer-findings.md), the rules DOMPurify applies, run on both engines).
   - **`class` is an allowlist** (`allowedClasses`, exact or `prefix*`); a profile that lists
     none allows no class ([ADR 0011](adr/0011-class-allowlist.md)).
   - **`cid:`** (email-v1) is resolved through the caller's `resolveCid` or removed, on
     `img src`/`background` only; the resolver's answer must be `https:`, `blob:` or a raster
     `data:` URL ([ADR 0009](adr/0009-email-v1.md)). Nothing is ever fetched.
   - **SVG and MathML** are dropped unless the profile opts in (`svg: "static"`,
     `mathml: "presentation"`), and then only a strict allowlist with character-scan value
     grammars, same-fragment references, text-only integration points and a placement
     check ([ADR 0010](adr/0010-svg-and-mathml-opt-in.md), `src/sanitize/enforce-foreign.ts`).
   - **Every URL-valued attribute is checked**, whatever the profile's own
     `urlAttributes` says: `src`, `href`, `srcset`, `imagesrcset`, `poster`,
     `action`, `formaction`, `xlink:href`, `background`, `ping`, `cite`,
     `data`, ... -- including on custom elements. Values go through
     `checkUrl()` (`src/policy/url.ts`) against `profile.urlSchemes`. **This
     uses the platform `URL` parser, never regex.** `srcset`/`imagesrcset` are
     parsed per the HTML algorithm and **every** candidate must pass, `ping`
     per token. A disallowed or unparseable URL removes the attribute
     entirely, not rewritten to something "safe-looking."
   - **Protocol-relative and backslash URLs** (`//host`, `\\host`, `/\host`)
     inherit their scheme from the _document_. `checkUrl` resolves them
     against the document's own base (`document.baseURI`), so on an `http:`
     page `//evil.example/x` is judged as `http:`, not assumed `https:`. Where
     the base cannot resolve them (`about:blank`, `data:`), they are rejected.
   - **Relative URLs on auto-loading attributes** (`img src`, `srcset`,
     `poster`, ...) are removed when the profile sets
     `blockRelativeAutoLoadUrls` (`email-v1` does). Otherwise a relative
     `<img src="/logout">` is a credentialed same-origin GET with no click
     (safe-fragment#6).
   - **`target`** is dropped unless its trimmed, lowercased value is `_blank`;
     a kept target is normalized to `_blank` and the anchor's `rel` is
     overwritten with `noopener noreferrer`. Unconditional; no profile flag.
   - **`<button>`** is forced to `type="button"`.
   - **`id` namespacing** (DOM clobbering; opt out only with `idPolicy: "keep-in-shadow"`, below): every surviving `id` is prefixed
     with `user-content-`, and every in-fragment reference is rewritten
     consistently (`href="#x"`, `for`, `aria-controls`, `aria-labelledby`,
     `aria-describedby`, `aria-owns`, `headers`, `list`, ...). Authors can
     never create `window.scriptUrl`, shadow `document.getElementById("app")`,
     or collide with the host's ids; fragment links and `label for` keep
     working inside the fragment. DOMPurify's own `SANITIZE_NAMED_PROPS` and
     `SANITIZE_DOM` are off so ids are prefixed exactly once and both engines
     treat colliding values (`id="title"`, `<slot name="title">`) alike.
     A `name` on an element that creates named properties (`img`, `form`,
     `iframe`, `object`, `embed`, `a`, `area`, form controls; no built-in allows
     it, a derived profile can) is prefixed the same way, under every policy.
   - **`idPolicy: "keep-in-shadow"`** (opt-in, [ADR 0005](adr/0005-component-templates-and-id-policy.md)):
     ids and references are left as written. Safe only when the fragment
     lands in a shadow root, where named access on `window`/`document` cannot
     see it. `<safe-fragment id-policy="keep-in-shadow">` rejects with
     `INVALID_OPTION` unless `scope="shadow"`; `sanitizeToFragment(html, { idPolicy: "keep-in-shadow" })`
     cannot see where you insert the result, so that guarantee is the caller's.
     Residual risk: a kept id can collide with one the component looks up
     itself, and the fragment is clobberable if you insert it into light DOM.
     Everything else is still enforced. Do not combine it with a derived
     profile that allows `form` controls or `name` for content you do not trust.
   - **`<style>` is not supported**, in any profile: it is dropped with its
     content ([ADR 0006](adr/0006-style-element-is-a-non-goal.md)). Keep
     component stylesheets outside the sanitized template.
8. **Rebuild** (`src/sanitize/rebuild.ts`). The enforced fragment is rebuilt
   from fresh `createElement`/`createTextNode` calls, copying only surviving
   attributes. A DOM node can carry hidden state no attribute check can see
   (a customized built-in's `is` value survives `removeAttribute("is")` and is
   re-emitted by the serializer; inserted into a document whose registry
   defines that extension it would be upgraded). After this pass the output is
   exactly the allowlisted tree.
9. **Insertion.** Only after all of the above does the (now fully
   profile-conformant) fragment get moved into the live DOM, via
   `Element.replaceChildren()` on a dedicated wrapper element (see
   `getRenderedRoot()`). Nothing the engines parsed was ever in the live
   document, so no resource load started early.
10. **`render`** fires with the `SanitizationReport` and the rendered root.
    **`reject`** fires instead, with a stable error code, if any step above
    failed; the previously rendered content is **cleared** (so content never
    stays on screen under a profile or source the element no longer claims).

## The `src` fetch

Disabled by default (`FETCH_DISABLED`). When enabled it is GET-only,
`credentials: "same-origin"`, same-origin unless `allowedOrigins` lists the
target, size-capped (checked via `Content-Length` and while streaming) and
time-limited. Specifically:

- **Redirects are refused** (`redirect: "error"`). `followRedirects: true`
  opts in; the final `response.url` origin is then re-validated against the
  same-origin/`allowedOrigins` policy and a redirect elsewhere rejects with
  `FETCH_REDIRECT_NOT_ALLOWED`.
- The timeout stays armed **until the body is fully read**, so a server that
  sends headers and then stalls cannot hold a render open.
- Network and abort failures, including mid-stream ones, map to
  `FETCH_FAILED`/`FETCH_ABORTED`/`FETCH_TIMEOUT`, not to a sanitize error.
  A render overtaken by a newer one resolves `superseded` (`FETCH_SUPERSEDED`
  on the result, no event); an abort from `clear()`, disabling, disconnecting
  or the element's window going away resolves `superseded` with
  `FETCH_ABORTED`, also without an event.

## Trusted Types

`<safe-fragment>` works under `require-trusted-types-for 'script'`. The
native path uses `setHTML` (not gated), and no sink that Trusted Types gates
is ever called with a string, so sanitizing produces **zero** violations and
CSP reports in every engine (tested with a `securitypolicyviolation`
listener; [ADR 0007](adr/0007-no-gated-sink-in-the-native-report.md)). The DOMPurify path registers one
`dompurify` policy per window (add `dompurify` to your `trusted-types` list;
`'allow-duplicates'` is not needed). `<example-sandbox>` is a different
component with its own policy name (`safe-fragment-sandbox`); see the README.

## Cost and denial of service

- `maxInputLength` (default 1,000,000 UTF-16 code units, configurable per
  `registerSafeFragment`/`sanitizeToFragment` call) rejects larger strings
  with `SOURCE_TOO_LARGE` before any parsing. This bounds, but does not
  eliminate, the cost below. The `src` fetch has its own, smaller byte cap
  (default 250,000).
- **The DOMPurify fallback is quadratic in the number of removed nodes**: it
  detaches nodes one at a time, and a payload of 100,000 removable elements
  was measured at 12-47 seconds on the main thread. Native `setHTML` does not
  have this profile. Safari (no `setHTML`) always takes the DOMPurify path.
  If you render attacker-sized content there, set a lower `maxInputLength`;
  safe-fragment#5 tracks a real fix.
- `SanitizationReport.outputLength` is an approximation accumulated during the
  rebuild walk (no extra serialization pass).

## What is logged, and what is not

`SanitizationReport` (and the `reject` event's detail) never include the
full original or sanitized markup string. Each removal/rewrite note
(`SanitizationNote`) carries the element tag, the attribute name (if
applicable), a short stable machine-readable `reason` string, and a
`snippet` of the offending _value_ truncated to 60 characters (engine-level
removals carry no snippet). This is deliberate: a sanitization report is
diagnostic data an application might reasonably log or send to telemetry, and
logging an entire attacker-controlled payload by default is itself a (smaller,
but real) risk surface -- log injection, oversized log entries, accidentally
persisting exactly the payload a security review would want redacted.

Reasons you will see: `removed-by-engine:native`, `removed-by-engine:dompurify`,
`element-dropped:dangerous-container`, `element-dropped:foreign-namespace`,
`element-unwrapped:not-in-profile`,
`element-unwrapped:custom-element-not-registered`,
`forbidden-attribute-class`, `style-attribute-disallowed`,
`data-attribute-not-allowlisted`, `attribute-not-in-profile`,
`disallowed-url-scheme:<scheme>`, `relative-url-on-auto-load`. A note in
`removedElements` means that element was removed; unwrapped elements still
have their children in the output.

## What this package does not protect against

Being explicit about scope, per the project's "prefer the conservative,
documented interpretation over silently overreaching" instruction:

- **Host selectors matched by classes you allow.** `class` is an allowlist and
  `ui-v1` allows none; the classes a derived profile names are as safe as the host's
  stylesheet treats them ([ADR 0011](adr/0011-class-allowlist.md)). `part` is the same class
  of styling hook for component templates.
- **CSP reports from the browser's own parser, if you opt out of the iframe realm.** In
  Chromium, parsing hostile input that contains `style=`, `<style>` or `<base>` reports
  `style-src-attr` / `style-src-elem` / `base-uri` violations although the output is clean; the
  parser does it in every document context. The library avoids it by parsing in a hidden
  same-origin `about:blank` iframe on Chromium (`inertRealm: "auto"`,
  [ADR 0012](adr/0012-parse-realm-iframe-for-csp.md)), which is visible to
  `querySelectorAll("iframe")` and observers; `inertRealm: "document"` never adds it and accepts
  the reports (safe-fragment#13, pinned in `test/integration/csp-violations.test.ts`).
- **Same-origin GET side effects from relative image URLs** under
  `article-v1`/`ui-v1` (safe-fragment#6); opt in to
  `blockRelativeAutoLoadUrls` via `deriveProfile`.
- **Content-level phishing/social engineering.** A sanitized `<a
href="https://evil-but-syntactically-fine.example/">Your Bank</a>` is
  not a code-execution bug, and this library does not attempt to detect
  or block it.
- **Unbounded cost under the size cap on the DOMPurify path** (see above,
  safe-fragment#5).
- **Anything inside `<example-sandbox>`.** See ADR 0001's "Consequences"
  and docs/architecture.md -- that component's entire purpose is running
  real code; its only guarantee is iframe-level isolation from the host page,
  not from the code it runs.
- **What your own custom elements do** with the sanitized attributes they
  receive.
- **SVG/MathML** are opt-in and partial (no animation, `image`, `foreignObject`,
  filters, `style`; `<use>` is dropped by the native engine and kept by DOMPurify), and
  `email-v1` has no CSS and loads remote `https:` images (tracking pixels).
- **Anything the independent security review has not yet covered**
  (safe-fragment#1).
