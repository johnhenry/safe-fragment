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
[ADR 0007](adr/0007-no-gated-sink-in-the-native-report.md) (no Trusted-Types-gated sink, even for the report).

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
     so nothing loads or runs), in `<body>`/`<div>` context, so the same
     input yields the same tree in both. The native engine runs in a
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
   - **`id` namespacing** (DOM clobbering): every surviving `id` is prefixed
     with `user-content-`, and every in-fragment reference is rewritten
     consistently (`href="#x"`, `for`, `aria-controls`, `aria-labelledby`,
     `aria-describedby`, `aria-owns`, `headers`, `list`, ...). Authors can
     never create `window.scriptUrl`, shadow `document.getElementById("app")`,
     or collide with the host's ids; fragment links and `label for` keep
     working inside the fragment. DOMPurify's own `SANITIZE_NAMED_PROPS` is off
     so ids are prefixed exactly once.
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

- **CSS-based attacks via the `class` attribute.** `article-v1` and
  `email-v1` do not allow `class` at all; `ui-v1` does (needed for
  practical component styling) with no attempt to validate class _names_
  against the host page's actual stylesheet (safe-fragment#7).
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
- **SVG/MathML** are not supported at all (safe-fragment#3), and `email-v1`
  is a scaffold (safe-fragment#2).
- **Anything the independent security review has not yet covered**
  (safe-fragment#1).
