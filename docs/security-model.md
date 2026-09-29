# Security model

This document is the detailed companion to the README's "Security model"
section. Read that first for the summary; this is the "how, exactly" for
each guarantee.

See also: [ADR 0001](adr/0001-html-as-data-not-code.md) (why untrusted
input is always treated as data, never assigned via `innerHTML`-family
sinks), [ADR 0002](adr/0002-native-sanitizer-with-dompurify-fallback.md)
(the two-engine-plus-shared-enforcement sanitization design), and
[ADR 0003](adr/0003-shadow-dom-is-not-sandboxing.md) (why `scope="shadow"`
is styling encapsulation, not isolation).

## The pipeline, precisely

```
string  ──▶  engine (native setHTML | DOMPurify)  ──▶  enforceProfile()  ──▶  DocumentFragment
             "make it inert, roughly to profile"      "the actual allowlist,   (still detached;
                                                         identical either way"   not yet inserted)
```

1. **Source resolution.** `<safe-fragment>` picks exactly one markup
   source per the documented precedence (`.html` property > `<template>`
   child > `src` > legacy `content` attribute). In `strict` mode, more
   than one present source is a hard `AMBIGUOUS_SOURCE` rejection instead
   of silently picking by precedence.
2. **Profile resolution.** The `profile` attribute/property must name a
   registered profile (a built-in, or one registered via a future
   `defineProfile`-based custom profile mechanism). An unknown or missing
   profile is a hard `UNKNOWN_PROFILE` rejection -- there is no implicit
   default profile, on purpose: rendering _something_ under a wrong-by-
   accident profile is worse than rendering nothing.
3. **`before-render`.** A cancelable event fires before any parsing
   happens. An application can inspect `detail.profile`/`detail.sourceKind`
   and veto the render entirely with `preventDefault()`.
4. **Sanitization** (`src/sanitize/index.ts`):
   - `mode: "text"` profiles (`plain-text-v1`) skip this whole pipeline:
     the string becomes a single `Text` node via `document.createTextNode`,
     and no HTML parser is ever invoked on it.
   - `mode: "html"` profiles feature-detect the native Sanitizer API
     (`Element.prototype.setHTML`) and use it when available; otherwise
     DOMPurify, configured with an explicit allowlist derived from the
     profile (never DOMPurify's own defaults).
   - Either way, the result is a **detached** `DocumentFragment` --
     nothing has touched the live document yet, so even a hypothetical
     `<img>` with a bad `src` that survived this far cannot have started
     loading (detached `template.content`/fragments do not fetch
     resources).
5. **`enforceProfile()`** (`src/sanitize/enforce.ts`) -- the authoritative
   allowlist pass, run identically regardless of which engine produced the
   fragment:
   - Walks every element via `fragment.querySelectorAll("*")`.
   - Removes any element whose tag is not in the profile's `elements` map
     (and, for `ui-v1`, not an application-registered custom element) --
     **the whole subtree goes with it**, it is not unwrapped.
   - For elements that survive, removes any attribute not on that
     element's specific allowed-attribute list, with three hardcoded
     exceptions that apply regardless of profile configuration:
     - Any attribute matching `on*` (case-insensitive), plus a small
       explicit denylist (`formaction`, `srcdoc`, `action`,
       `xlink:href`), is **always** removed, even if a profile or an
       application's `defineProfile` custom-element registration
       mistakenly lists it. This is a backstop, not the primary defense.
     - `style` is removed unless the profile's `allowStyleAttribute` is
       `true` (no shipped v1 profile sets this).
     - `data-*` attributes are kept only when `allowDataAttributes` is
       `true` for the profile (only `ui-v1`).
   - For URL-valued attributes (`profile.urlAttributes`, typically
     `href`/`src`/`cite`), validates the value with `checkUrl()`
     (`src/policy/url.ts`) against `profile.urlSchemes`. **This uses the
     platform `URL` parser, never regex** -- see that file's doc comment.
     A disallowed or unparseable URL means the attribute is removed
     entirely, not rewritten to something "safe-looking."
   - `target="_blank"` anchors get `rel="noopener noreferrer"` forced
     unconditionally (profiles that enable `forceRelOnBlankTarget`),
     closing the reverse-tabnabbing hole regardless of what `rel` the
     source markup requested.
   - HTML comments are stripped entirely (a `TreeWalker` pass), closing
     off comment-based markup-smuggling techniques against either engine.
6. **Insertion.** Only after all of the above does the (now fully
   profile-conformant) fragment get moved into the live DOM, via
   `Element.replaceChildren()` on a dedicated wrapper element (see
   `getRenderedRoot()`).
7. **`render`** fires with the `SanitizationReport` and the rendered root.
   **`reject`** fires instead, with a stable error code, if any step above
   failed.

## What is logged, and what is not

`SanitizationReport` (and the `reject` event's detail) never include the
full original or sanitized markup string. Each removal/rewrite note
(`SanitizationNote`) carries the element tag, the attribute name (if
applicable), a short stable machine-readable `reason` string, and a
`snippet` of the offending _value_ truncated to 60 characters. This is
deliberate: a sanitization report is diagnostic data an application might
reasonably log or send to telemetry, and logging an entire attacker-
controlled payload by default is itself a (smaller, but real) risk surface
-- log injection, oversized log entries, accidentally persisting exactly
the payload a security review would want redacted. An application that
genuinely needs the full input for its own audit trail already has it (it
supplied the string); this library does not re-surface it by default.

## What this package does not protect against

Being explicit about scope, per the project's "prefer the conservative,
documented interpretation over silently overreaching" instruction:

- **CSS-based attacks via the `class` attribute.** `article-v1` and
  `email-v1` do not allow `class` at all; `ui-v1` does (needed for
  practical component styling) with no attempt to validate class _names_
  against the host page's actual stylesheet. If the host application's own
  CSS has a selector that does something dangerous when a class from
  attacker-controlled markup happens to match it, that is a host-page
  design issue this library cannot see into.
- **Content-level phishing/social engineering.** A sanitized `<a
href="https://evil-but-syntactically-fine.example/">Your Bank</a>` is
  not a code-execution bug, and this library does not attempt to detect
  or block it.
- **Denial of service via pathological input.** There is no built-in
  parse-time-complexity guard beyond the `src` fetch's byte-size cap
  (`FetchCapability.maxBytes`). A very large `.html`/template-child string
  supplied directly (not via `src`) is sanitized at whatever cost the
  engine and `enforceProfile`'s DOM walk incur -- callers feeding
  attacker-sized strings directly into `.html` (bypassing the `src` cap
  entirely) are responsible for their own size limits.
- **Anything inside `<example-sandbox>`.** See ADR 0001's "Consequences"
  and docs/architecture.md -- that component's entire purpose is running
  real, unsandboxed-from-a-scripting-perspective code; its only guarantee
  is iframe-level isolation from the host page, not from the code it runs.
