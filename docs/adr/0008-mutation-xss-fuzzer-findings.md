# ADR 0008: Findings of the mutation-XSS fuzzer: attribute-value hardening and one parser context

## Status

Accepted. Refines [ADR 0002](0002-native-sanitizer-with-dompurify-fallback.md) and
[ADR 0004](0004-disallowed-elements-unwrap-or-drop.md).

## Context

`test/fuzz/` (see [the reviewer packet](../review/README.md#the-fuzzer)) generates
random and mutated markup from the XSS and benign corpora plus grammar fragments
(namespace switches, raw-text elements, attribute quoting, entities, comment/CDATA/PI
tricks) and runs it through both engines and every built-in profile. Per input,
engine and profile it checks: nothing executes (a CSP-tripwire frame), the output
satisfies the profile (an independent verifier), re-sanitizing the output removes
nothing a host's re-parse would keep and is a fixpoint, parse -> serialize -> parse of
the output is stable and still conformant, and the two engines agree unless the
difference is documented.

The first runs found four things. None was a script-execution bypass; the first two
are the mutation-XSS shape (output that is safe as a tree but not as text), the last two
are parser-context differences between the engines.

## Decisions

**F1. An attribute value that is markup to some parser is dropped, on both engines.**
`enforceProfile` removes any attribute whose value contains `-->`, `--!>`, `]>`, `/>`
or the end tag of a raw-text/RCDATA element (`</style`, `</script`, `</title`, `</xmp`,
`</textarea`, `</noscript`, `</iframe`, `</noembed`, `</noframes`, any case).
Serializers that do not escape `<`/`>` in attribute values (all browsers before 2025,
and any host that serializes itself) emit such a value verbatim, and a host that stores
or re-inserts the output inside `<noscript>`, `<title>`, `<textarea>`, foreign content
or after a comment closer can see it become markup
(`<p title="</noscript><img src=x onerror=alert(1)>">`). DOMPurify already drops these
(`SAFE_FOR_XML`, `ALLOW_SELF_CLOSE_IN_ATTR: false`); the native engine kept them. The
rule is now `enforceProfile`'s, so both engines agree. Cost: a `title` such as
`"a --> b"` is dropped. Reason in the report: `attribute-value-markup-breakout`.

**F2. A script-scheme value in any attribute is dropped, on both engines.** A value that
starts, after whitespace/control/format characters are removed, with `data:` or with a
word ending in `script` and a colon (`javascript:`, `vbscript:`, `avascript:`) is removed
from every attribute that is not a URL attribute (URL attributes already go through
`checkUrl`). This is DOMPurify's rule for non-URL attributes (`^(?:\w+script|data):`);
the native engine kept `lang="javascript:alert(1)"`. It is inert until something reads
the attribute as a URL, which is exactly what custom elements and host scripts do.
Cost: a value starting with `transcript:` is dropped. Reason:
`script-scheme-in-attribute`. Implemented with a character scan (`hasScriptScheme`,
`src/policy/url.ts`), not a regex.

**F3 (was D1). `<frameset>` must not replace the body.** DOMPurify parses a whole
document; a `<frameset>` start tag that reaches the body insertion mode replaces
`<body>`, DOMPurify finds none and returns `""`, which the library rejected with
`SANITIZE_FAILED`, while the native engine (a `<div>` context, where `<frameset>` is
ignored) rendered the rest of the input.

**F4 (was D2). Both engines parse in standards mode.** DOMPurify's document had no
doctype, so it was in quirks mode, where `<table>` does not close an open `<p>`:
`<p>a<table>` nested on DOMPurify and split on native, and text foster-parented into
different parents.

F3 and F4 are both fixed by the string DOMPurify parses: `<!DOCTYPE html><xmp></xmp>`
before the input, with DOMPurify's `FORCE_BODY` off. The doctype gives standards mode;
`<xmp>` starts the body (as `FORCE_BODY`'s `<remove>` did) and a start tag `xmp` also
clears the parser's "frameset-ok" flag, so a later `<frameset>` is ignored exactly as in
a `<div>`. `xmp` is in the drop-subtree list, so the sentinel never reaches the output,
and the report skips it as it skipped `<remove>`.

**D3 stays a documented divergence.** DOMPurify drops an element whose text contains `<x`
when its serialization also contains markup-looking text (an in-element comment from
`</ >`, for example). The native engine keeps it. It over-removes, never under-removes,
so it is fail-safe; the fuzzer tolerates it only when DOMPurify's text is a subsequence of
native's and the input has a comment-like token (`test/fuzz/divergences.ts`).

## Consequences

- Every fix has a regression test in `test/unit/enforce.test.ts` and a fixture in the XSS
  or benign corpus (`F1`, `F2`, `F3`, `D2`), run on both engines by the equivalence suite.
- The fuzzer runs in CI with a fixed seed and a small budget (`npm test`); `npm run fuzz`
  raises it. The seeds, budgets and the oracle definitions are in the reviewer packet.
- The XSS corpus grows by whatever the fuzzer finds; a finding is not closed without a
  fixture.
