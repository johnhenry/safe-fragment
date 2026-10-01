# ADR 0009: `email-v1`: `cid:` through a resolver, Office markup dropped, layout attributes allowed

## Status

Accepted. Resolves safe-fragment#2.

## Context

`email-v1` was a scaffold: an article-like profile with a handful of table elements. Real
HTML email has three habits it did not handle: inline images by `cid:` (RFC 2392: a MIME
part of the same message), Outlook's conditional comments and VML, and table-based layout
carried in presentational attributes (`bgcolor`, `align`, `valign`, `cellpadding`,
`background`...) because inline `style` is how mail clients style everything else.

## Decision

**`cid:` is an allowlisted scheme the library resolves through the caller and never
fetches.** `email-v1.urlSchemes` lists `cid:`. A `cid:` URL is accepted only on an
attribute that loads an image of the message (`img src`, and `background`); on `href`,
`srcset` or anywhere else it is removed (`cid-not-allowed-here`). The content-id
(percent-decoded, no scheme) is handed to a `resolveCid(contentId)` the caller supplies to
`sanitizeToFragment`/`sanitize` or `registerSafeFragment`. Its answer is **validated again
before it is written**, because it is the one value in the output that did not come from the
markup, and `(cid) => base + cid` must not become an injection through an attacker-chosen
id: only `https:`, `blob:` and `data:` URLs of a raster image type
(`png jpeg gif webp avif bmp`, never SVG) pass, with no whitespace or control characters;
`javascript:`, `http:`, protocol-relative, relative, `data:text/html`, `cid:` again,
non-strings and a resolver that throws all mean "unresolved". Unresolved (no resolver
included) removes the attribute (`cid-unresolved`): the output never contains a `cid:` URL,
and nothing is fetched. `blob:` and `data:` can appear in the output only through this path
(`registerProfile` still refuses them as profile schemes).

**Conditional comments are comments.** `<!--[if mso]>...<![endif]-->` is stripped with all
comments, content included (the Outlook-only branch). The downlevel-hidden form,
`<!--[if !mso]><!-->...<!--<![endif]-->`, is two complete comments around real markup, so
the content for everyone else survives. The downlevel-revealed form (`<![if mso]>`) is a
bogus comment in the HTML parser; its content is real markup and is sanitized like any other.

**VML and Office XML outside comments are dropped with their text.** A new profile field,
`dropElements` (exact names or `prefix*`), extends the drop-with-subtree rule of ADR 0004 for
one profile: `email-v1` drops `v:*`, `w:*`, `m:*`, `xml` and the `o:` settings elements.
Without it the unwrap rule would promote a VML button's fallback label and the values of
`<xml><o:OfficeDocumentSettings>` into visible text. `<o:p>` (a Word paragraph marker around
`&nbsp;`) is deliberately not in the list: unwrapping it is right. Both engines must drop
the same subtree, and DOMPurify cannot take a wildcard, so DOMPurify is told (through the
element hook already used for custom elements) to leave these elements alone and
`enforceProfile` is the single place they are dropped; the native engine does not remove
unknown elements.

**Table-layout attributes, from a fixed list.** `table`, `tr`, `td`, `th`, sections, `col`,
`img`, `hr`, `font`, `center` and the block elements carry the presentational attributes real
mail uses: `width height align valign bgcolor border cellpadding cellspacing colspan rowspan
nowrap summary background`, `hspace vspace` on `img`, `color face size` on `font`. Their values
are parsed by the legacy HTML attribute algorithms (a colour, a length), never as CSS, and are
not URL-checked, except `background`, which loads and goes through `checkUrl` like `src`
(`https:` and `cid:`; relative auto-loads stay blocked). `style`, `class` and `<style>` are
unsupported (ADR 0006, ADR 0011).

## Consequences

- Mail renders with its layout but without its CSS. Two visible consequences, both
  documented in docs/profiles.md: a "hidden" preheader (`style="display:none"`) becomes
  visible text, and colours/fonts set by CSS are lost.
- Remote `https:` images still load, which is a tracking pixel by design of the format. A
  profile derived with `urlSchemes: ["relative", "mailto:", "cid:"]` refuses remote loads.
- The corpus (`test/fixtures/email-corpus.ts`) holds real-world-style newsletters, a receipt,
  Word-generated mail, a quoted reply and a `cid:` mail, plus the hostile cases; it runs
  through both engines with a resolver and is compared, and feeds the fuzzer's seeds.
- The fuzzer runs email-v1 with a hostile resolver (safe answers, every unsafe kind, echoes of
  the attacker-chosen id, throws, non-strings).
