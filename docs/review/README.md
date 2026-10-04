# Reviewer packet for safe-fragment#1

This is the starting point for the independent security review
([safe-fragment#1](https://github.com/johnhenry/safe-fragment/issues/1)). It is written to be read in
about an hour and to point at code, not to replace reading it. Nothing here is a sign-off; the package
is unreleased (`0.0.0`) and the first release waits for yours.

Everything below is true of the commit this packet was written against; line numbers are for that commit
(`git log -1 -- docs/review/README.md`). The files that matter are small: about 1,400 lines of boundary code
(`src/sanitize/enforce.ts`, `enforce-foreign.ts`, `rebuild.ts`, `src/policy/url.ts`, `cid.ts`, `foreign.ts`)
and about 700 lines of engine glue (`native.ts`, `dompurify.ts`, `config.ts`, `index.ts`).

Contents: [1 Threat model](#1-threat-model) / [2 Trust boundary and code map](#2-trust-boundary-and-code-map) /
[3 ADRs](#3-the-adrs-summarized) / [4 DOMPurify settings that are looser than its defaults](#4-dompurify-settings-that-are-looser-than-its-defaults) /
[5 Known divergences](#5-known-divergences) / [6 Deliberate strictness](#6-deliberate-strictness-things-that-look-like-bugs) /
[7 The fuzzer](#the-fuzzer) / [8 Test inventory](#8-test-inventory) / [9 Open security issues](#9-open-security-issues) /
[10 Questions for the reviewer](#10-questions-for-the-reviewer) / [11 Reproducing everything](#11-reproducing-everything)

## 1. Threat model

**What is protected.** The origin of the page that renders the content: its script execution context, cookies and
storage, its DOM and its window/document namespace, its navigation, and what its network requests reveal.

**The attacker.** Whoever authored the markup string. They control every byte of it, know the library and its version,
may target a specific engine (native `setHTML` in Chromium/Firefox, DOMPurify in Safari), and may craft input that is
safe as a tree but not as text (mutation XSS) for a host that serializes the output (cache, `outerHTML`, a server round
trip) and parses it again. In `email-v1` they also choose the `cid:` content-id that reaches the caller's resolver.

**In scope (a finding if it is possible):**

- Script execution from the output, by any route: element, attribute, `javascript:`/`data:`/`vbscript:` URL, event handler,
  `<use>`/animation/`foreignObject`, a re-parse of the serialized output in any element context (`<noscript>`, `<title>`,
  `<textarea>`, foreign content).
- Anything the browser loads or navigates without a click that the profile did not intend: `img src`, `srcset`, `poster`,
  `background`, `<link>`, `<base>`, `<meta refresh>`, `<form action>`; a `target` that reaches the opener.
- DOM clobbering of `window`/`document`/the host's ids and names; shadowing by `name`/`id`.
- Output that differs by engine in a way that lets one engine's output exceed the profile (the allowlist is the same
  code for both; a difference is a bug or a documented divergence, see [5](#5-known-divergences)).
- A parser or serializer differential between what `enforceProfile` saw and what the browser makes of the rebuilt output.
- UI redress by class names matching host selectors (`allowedClasses`), and by SVG/MathML if opted in.
- Denial of service beyond the documented cost model (`maxInputLength`; DOMPurify's quadratic removal, issue #5).
- Under `require-trusted-types-for 'script'`: any call of a gated sink with a string, and any CSP report the library
  itself causes.

**Out of scope, on purpose** (each is documented in the README's "What is still yours"):

- What the host does with the output beyond inserting it (its own `innerHTML` of the serialization, its own event handlers).
- What a registered custom element does with the sanitized attributes it receives.
- Content-level abuse that is not code execution: phishing links, tracking pixels in `https:` images.
- `<example-sandbox>` (a separate component whose purpose is to run application-authored code in a sandboxed iframe).
- Shadow DOM as isolation (it is not one, ADR 0003) and CSS (`style` and `<style>` are unsupported, ADR 0006).
- The `src` fetch capability's network side (a separate, small, default-off model; reviewed in `docs/security-model.md`).

**Assumptions the design leans on.** The browser's HTML parser and `URL` parser are correct and deterministic for a given
input; `setHTML`'s built-in baseline strips `<script>`, handlers and `javascript:` URLs (defence in depth only: nothing relies
on it, `enforceProfile` re-derives all of it); the host inserts the output with DOM APIs (`replaceChildren`/`append`), never by
serializing it. If the host does serialize it, the mutation-XSS defenses in [ADR 0008](../adr/0008-mutation-xss-fuzzer-findings.md)
apply and are fuzzed, but they are best-effort.

## 2. Trust boundary and code map

```
string ─▶ size check ─▶ engine (native setHTML | DOMPurify)  ─▶ enforceProfile ─▶ rebuild ─▶ DocumentFragment
          (index.ts)     parse in an inert document;           THE BOUNDARY       fresh nodes   (detached)
                         "roughly to profile"                  (enforce*.ts,      (rebuild.ts)
                         (native.ts, dompurify.ts, config.ts)   url.ts, cid.ts,
                                                                foreign.ts)
```

Everything left of `enforceProfile` is an untrusted first pass: either engine could be wrong, and `enforceProfile`'s output must
be profile-conformant regardless. Everything right of it is a copy of what `enforceProfile` accepted.

| Piece                                             | Where                                                                                                                                                                                                                              | What to look at                                                                                                                                                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry, size check, engine choice, report assembly | `src/sanitize/index.ts:91` `sanitize`, `:117` `sanitizeSync`, `:160` `finish`                                                                                                                                                      | Order: engine, then `enforceProfile`, then `rebuildWithLength`. `plain-text-v1` never reaches an engine (`textResult`).                                                                                                                                       |
| **`enforceProfile`**                              | `src/sanitize/enforce.ts:368`                                                                                                                                                                                                      | The allowlist pass. One snapshot walk (`:386`), comments stripped first (`:373`, `:527`), foreign namespaces handed to `enforce-foreign.ts` (`:390`), disallowed HTML elements dropped or unwrapped (`:416`-`:445`), then the attribute loop (`:447`-`:512`). |
| ...hard denylist, markup-breakout, script-scheme  | `enforce.ts:30` `HARD_DENYLIST_ATTRS`, `:447`, `:453` + `:186` `attributeValueBreaksOut`, `:473`/`:508` + `url.ts:177` `hasScriptScheme`                                                                                           | The backstops that apply whatever a profile says; F1/F2 of ADR 0008.                                                                                                                                                                                          |
| ...URL attributes                                 | `enforce.ts:43` `URL_VALUED_ATTRS`, `:126` `checkUrlAttribute`, `:500`; `:78` `parseSrcsetUrls`; `:65` `AUTO_LOAD_ATTRS`                                                                                                           | Every URL-valued name is checked whatever the profile lists; `srcset` per candidate, per comma segment and as a whole; `cid:` eligibility (`:122`).                                                                                                           |
| ...`cid:` resolution                              | `enforce.ts:316` `resolveCidAttribute`; `src/policy/cid.ts:21` `extractContentId`, `:45` `isSafeResolvedUrl`                                                                                                                       | The one place a value that is not from the markup enters the output (a resolver's answer, re-validated).                                                                                                                                                      |
| ...class, target, button, ids, names              | `enforce.ts:486`, `:515`/`:548` `hardenAnchorTarget`, `:519`, `:521`/`:257` `namespaceIds`, `:520`/`:307` `namespaceName`                                                                                                          | `allowedClasses` (ADR 0011); `target` only `_blank` plus forced `rel`; forced `type="button"`; `user-content-` ids and reference rewriting.                                                                                                                   |
| **`checkUrl`**                                    | `src/policy/url.ts:71` (`checkUrlOnce` `:127`, `usableBase` `:32`)                                                                                                                                                                 | `URL`-parser based, no regex. Authority-bearing relative URLs (`//h`, `\\h`) resolve against the document base; a second, stricter look squeezes invisible characters (`isInvisibleUrlChar` `:95`, F6).                                                       |
| **Foreign content** (opt-in SVG/MathML)           | `src/sanitize/enforce-foreign.ts:51` `enforceForeignElement`, `:125` `enforceForeignAttribute`; `src/policy/foreign.ts` (`SVG_ELEMENTS` `:108`, `MATHML_ELEMENTS` `:143`, validators `:201`-`:296`, `isOptedInForeignName` `:328`) | Allowlists, value grammars (character scans), same-fragment references, text-only integration points, placement, namespaced attributes (only SVG `xlink:href`).                                                                                               |
| **Rebuild**                                       | `src/sanitize/rebuild.ts:31` `rebuildWithLength`                                                                                                                                                                                   | Fresh `createElement`/`createElementNS`/`createTextNode`, surviving attributes copied (`setAttributeNS` for namespaced). Removes hidden node state (a customized built-in's `is` value). Iterative, so deep nesting cannot overflow the stack.                |
| Profile validation                                | `src/policy/registry.ts:68` `validateAndFreeze`, `:190` `registerProfile`, `:249` `deriveProfile`                                                                                                                                  | What a custom profile may not contain: dangerous elements/attributes/schemes, `allowStyleAttribute`, bad `allowedClasses`/`dropElements`/`svg`/`mathml`.                                                                                                      |
| Shared drop list                                  | `src/sanitize/dangerous.ts:18` `DROP_SUBTREE_ELEMENTS`                                                                                                                                                                             | One list for the native `removeElements`, DOMPurify `FORBID_CONTENTS` and `enforceProfile` (ADR 0004), plus the foreign containers of ADR 0010.                                                                                                               |
| Engine config (shared)                            | `src/sanitize/config.ts:36` `buildBaselineConfig`                                                                                                                                                                                  | Profile to the elements/attributes both engines are told; foreign names and the native engine's case-sensitive spellings.                                                                                                                                     |
| Native engine                                     | `src/sanitize/native.ts:118` `sanitizeWithNative` (config `:121`), `:88` `parseInputInventory`                                                                                                                                     | `setHTML` in a `<div>` of a `createHTMLDocument` document; `removeElements` blocklist + `attributes` allowlist; the permissive second parse that only feeds the report.                                                                                       |
| DOMPurify engine                                  | `src/sanitize/dompurify.ts:219` `sanitizeWithDOMPurify` (config `:228`-`:268`), `:84` `getDOMPurify`, `:103` `getRealmDOMPurify`, hooks `:137`/`:147`, `PARSE_PREFIX` `:188`                                                       | One instance per window; explicit allowlist; the parse prefix (ADR 0008); the two hooks.                                                                                                                                                                      |

Where the line numbers drift, search for the symbol; the table is generated from `grep -n` of those names.

## 3. The ADRs, summarized

All twelve in [`docs/adr/`](../adr/); each is short and states what it does not solve.

1. **0001 HTML is data, never code.** No `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`setHTMLUnsafe` on untrusted strings anywhere in `src/` except `src/sanitize/`'s inert-document parse; no `unsafe`/`trusted`/`allowScripts` escape hatch in the API. `<example-sandbox>` is deliberately the opposite and separate. (Test code has one exception: the fuzzer's oracles, below.)
2. **0002 Native Sanitizer API, DOMPurify fallback, shared authoritative pass.** Feature-detect `setHTML`; fall back to DOMPurify (lazy `import()`); never DOMPurify's defaults; `enforceProfile` is the boundary and re-derives the allowlist; URL schemes by the `URL` parser, not a regex. Records the shipped `KEEP_CONTENT: false` bug the equivalence test caught.
3. **0003 Shadow DOM is not a security boundary.** `scope="shadow"` is styling only; no `mode: "closed"`; a sandboxed iframe is the only isolation primitive used (`<example-sandbox>`).
4. **0004 Disallowed elements: drop dangerous containers, unwrap the rest.** One rule in both engines and `enforceProfile`: raw-text/embedding/foreign containers (`dangerous.ts`) drop their subtree, everything else unwraps. Output is rebuilt from fresh nodes.
5. **0005 Component templates and `idPolicy`.** `component-template-v1` (`ui-v1` + `slot`/`part`); opt-in `idPolicy: "keep-in-shadow"` honored only with `scope="shadow"` on the element; clobberable `name` always prefixed; DOMPurify `SANITIZE_DOM` off and `ALLOW_UNKNOWN_PROTOCOLS` on for parity.
6. **0006 `<style>` is a non-goal.** A CSS sanitizer is a separate, larger surface (URL-bearing functions, `var()`, redress, parser differentials). Dropped with content; waits for a CSSOM design and your review.
7. **0007 No gated sink, even for the report.** Never call `DOMParser#parseFromString`, `innerHTML`, `createContextualFragment`, `setHTMLUnsafe` with a string: under Trusted Types that is a violation and a CSP report per call. The native report therefore cannot list the engine's unconditional removals.
8. **0008 What the fuzzer found.** F1 attribute values that are markup to some parser are dropped; F2 script-scheme values in any attribute; F3/F4 DOMPurify parses in standards mode behind a `<!DOCTYPE html><xmp></xmp>` prefix (frameset and quirks fixes); F6 BMP default-ignorable characters squeezed before the scheme check; D3 over-removal documented.
9. **0009 `email-v1`.** `cid:` only on `img src`/`background`, only through the caller's `resolveCid`, answer re-validated (`https:`/`blob:`/raster `data:`); MSO comments removed; VML/Office XML dropped via `dropElements`; legacy layout attributes from a fixed list; no CSS.
10. **0010 SVG and MathML opt-in.** `svg: "static"`/`mathml: "presentation"`; strict allowlists, character-scan value grammars, same-fragment references, text-only integration points, placement rules, namespace-correct rebuild; `use` is not equal across engines.
11. **0011 `class` is an allowlist.** `allowedClasses` exact or `prefix*`; `ui-v1` and `component-template-v1` allow none; prefixing rejected and why.
12. **0012 The parse realm.** On Chromium the engines parse through a same-origin `about:blank` iframe (`inertRealm: "auto"`) so the browser's own parser does not report CSP violations (`style-src-attr`, `style-src-elem`, `base-uri`) for clean output; falls back to the page's inert document; `"document"` opts out. **0013** corrects it: the attached iframe inherited the page's CSP and reported to its own document (the test watched only the page); the iframe is now removed right after it is made (DOMPurify created and its Trusted Types policy registered first), and the tests watch every document.

## 4. DOMPurify settings that are looser than its defaults

`src/sanitize/dompurify.ts:228`-`:268`. DOMPurify's own allowlists are never used (`ALLOWED_TAGS`/`ALLOWED_ATTR` are derived from the
profile and replace its defaults). The settings below differ from DOMPurify's defaults in the permissive direction; each exists
for engine parity, and the loss is covered by `enforceProfile`. Stricter-than-default settings are listed last.

| Setting                           | Value                                               | Why it is looser, and what covers it                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALLOW_UNKNOWN_PROTOCOLS`         | `true` (default `false`)                            | With `false`, DOMPurify drops any non-URL attribute whose value merely looks like `scheme:` (`exportparts="a:b"`, `data-action="cart:add"`) while the native engine keeps it: the same template rendered differently in Safari. Covered by: `checkUrl` on every URL attribute, F2 (`hasScriptScheme`) on every other attribute, both in `enforceProfile` (ADR 0005, 0008).                              |
| `SANITIZE_DOM`                    | `false` (default `true`)                            | It drops any `id`/`name` value that collides with a `document`/form property (`<slot name="title">`, `<p id="title">`) on this engine only. Covered by: `enforceProfile` prefixes every id and every clobberable `name` itself (`:257`, `:307`).                                                                                                                                                        |
| `SANITIZE_NAMED_PROPS`            | `false` (default `false`)                           | Kept off deliberately: on, ids would be prefixed twice and references desynchronized. Covered by the same prefixing.                                                                                                                                                                                                                                                                                    |
| `FORBID_CONTENTS`                 | our list (default: DOMPurify's list)                | Replaced, not extended, so the dropped-with-subtree set is identical to the native engine's and `enforceProfile`'s (ADR 0004). Looser than DOMPurify's default for `audio`, `video`, `colgroup`, `thead`, `desc` and the MathML token elements (they unwrap here); stricter for `textarea`, `select`, `object`, `embed`, `applet`, `frame`, `frameset`, `head`, `plaintext` and the foreign containers. |
| `FORCE_BODY`                      | `false` (default `false`; ADR 0004 had it `true`)   | Replaced by our own parse prefix `<!DOCTYPE html><xmp></xmp>` (ADR 0008): standards mode, body start, `<frameset>` ignored. Same job, plus two fixes.                                                                                                                                                                                                                                                   |
| Hook `uponSanitizeElement`        | allows custom-element tags and `dropElements` names | DOMPurify's own custom-element check rejects valid names with consecutive hyphens and cannot do prefix patterns. The hook sets `allowedTags[tag]` for tags the profile names, so DOMPurify leaves them for `enforceProfile` to judge (and for `dropElements`, so it does not unwrap and leak their text). Their attributes still go through DOMPurify's allowlist and then `enforceProfile`.            |
| Hook `beforeSanitizeAttributes`   | removes `is` instead of the element                 | DOMPurify force-removes any element carrying `is=`, native drops the attribute. Normalized to the latter; the hidden is-value is removed by the rebuild.                                                                                                                                                                                                                                                |
| `ALLOWED_TAGS` with foreign names | lowercase SVG/MathML names when opted in            | Needed for DOMPurify to keep them; `enforceProfile` still decides (ADR 0010). Side effect handled in `enforceProfile`: DOMPurify removes an HTML-namespace `<mi>`/`<path>` and a foreign `caption`/`figure` with their content.                                                                                                                                                                         |

Stricter than default (for completeness): `ALLOW_DATA_ATTR: false`, `ALLOW_SELF_CLOSE_IN_ATTR: false`, `KEEP_CONTENT: true` is
required (with `false`, an explicit `ALLOWED_TAGS` list silently deletes every text node, ADR 0002), `WHOLE_DOCUMENT: false`,
`RETURN_DOM_FRAGMENT: true`. Not set (so DOMPurify's defaults apply): `SAFE_FOR_XML` (on: DOMPurify's mXSS heuristics stay active,
and are the origin of D3), `SAFE_FOR_TEMPLATES`, `USE_PROFILES`, `ADD_TAGS`/`ADD_ATTR`, `FORBID_TAGS`/`FORBID_ATTR`, `NAMESPACE`,
`PARSER_MEDIA_TYPE`, `IN_PLACE`. DOMPurify is pinned to an exact version (`3.4.16`).

The native engine's config (`native.ts:121`) is a blocklist for elements (the drop list, plus the camelCase foreign names) and an
allowlist for attributes with `comments: false`, `dataAttributes: false`; it uses the current spec key names (the pre-2024 names are
silently ignored by Chromium).

## 5. Known divergences

Full list with reasons and tests: [known-divergences.md](known-divergences.md). In short: Firefox `<noscript>` parse (scripting flag, D5) and foster-parenting order out of a table (D6),
DOMPurify's mXSS heuristic over-removes in rare shapes (D3), the native engine removes `<use>` unconditionally (D4), the native
report cannot list the engine's baseline removals (ADR 0007), the parse realm differs by engine (an iframe on Chromium, ADR 0012), and output trees are not always parser-canonical (benign nesting drift). None is a way to exceed a
profile; each is safe by construction or by `enforceProfile`.

## 6. Deliberate strictness (things that look like bugs)

- `title="a --> b"`, `alt="x]>y"`, any value containing `/>` or `</style`-like text is **dropped** (F1).
- A value starting with `transcript:`, `data:` or any `...script:` is dropped from non-URL attributes (F2).
- `ui-v1` allows no classes; `email-v1` renders a "hidden" preheader visibly because `style` is gone.
- Disallowed foreign containers inside an opted-in SVG are dropped with content; an HTML element named like an opted-in foreign
  tag (`<mi>`, `<path>` outside `<svg>`) is dropped with its content (DOMPurify does that, so both do).
- `<use>` disappears on the native engine (D4).

<a id="the-fuzzer"></a>

## 7. The fuzzer

`test/fuzz/` (about 1,350 lines): a seeded, deterministic mutation-XSS differential fuzzer that runs in the same real-browser harness as
the rest of the suite.

**Input generation** (`grammar.ts`, `prng.ts`). A mulberry32 PRNG seeded per case (`caseSeed(seed, index)`), so any case reproduces from
`(seed, index)`. Three strategies, mixed: a corpus entry (every XSS, benign, email and foreign fixture, about 130 seeds) mutated a few times
(delete/duplicate/insert-state-character/insert-fragment/flip case/wrap in a namespace opener/swap/replace-with-URL); a sentence of 1-9 grammar
fragments; a corpus entry spliced between sentences. The fragments target the places parsers and serializers disagree: namespace switches
(`<svg>`, `<math>`, `<foreignObject>`, `<annotation-xml>`, `<mglyph>`, integration points, SVG animation and `use`), raw-text and RCDATA elements
(`style script xmp textarea title noscript noembed noframes iframe plaintext template select`), attribute syntax (quoting, backticks, duplicates,
`/` and NUL in names, entities in values, breakouts that close a raw-text element), entities (named without semicolon, numeric, out of range,
`&amp;lt;` double encoding), and comment/CDATA/PI/doctype/malformed-tag tricks (`--!>`, `<!-->`, `<![CDATA[`, MSO conditionals, `</ >`, `<%`).

**Oracles** (`oracles.ts`, `harness.ts`), per input x profile x engine:

1. **Nothing executes.** The output is mounted twice (as the tree, and as the serialization re-inserted with `innerHTML`, the one place a test
   parses a string outside `src/sanitize/`: it is library _output_, in a frame) in an iframe whose CSP forbids every script source, with
   `alert`/`prompt`/`confirm`/`print`/`eval` hooked. Any `script-src*`, `frame-src`, `object-src`, `form-action` violation or hook call is a failure.
2. **Conformance.** An independent verifier (it shares only `checkUrl` and the profile data with `enforceProfile`) walks the output: every element
   and attribute allowed, namespaces and placement, no handler/`style`, ids and names prefixed, every URL through `checkUrl`, no markup-breakout or
   script-scheme value, class tokens in `allowedClasses`, foreign values inside their grammars, `cid:` never present, resolver output only where legal.
3. **Re-sanitizing is stable (mXSS).** Sanitizing the serialized output removes nothing a host's re-parse would keep (compared as trees after a
   parse), and the next iteration is a string fixpoint.
4. **Parse -> serialize -> parse round trip.** The reparsed output is still conformant and a second round changes nothing. (Output trees are not
   always equal to their reparse: unwrapping can leave `<p><div>`; that is counted, not failed; see [known-divergences.md](known-divergences.md).)
5. **Engines agree.** Normalized trees of native and DOMPurify output are equal, or the difference is a documented divergence
   (`test/fuzz/divergences.ts`: D3, D4 everywhere; D5, D6 on Firefox). Anything else fails.

A failing case is shrunk by delta debugging and printed with its seed, index, both outputs and the reproduction command.

**Budgets and running it.**

- `npm test` runs it with seed `20261001`: 150 random cases per profile per engine, plus a replay of every corpus input through every profile and engine,
  on whatever browsers the run uses (about 2 s per browser).
- `npm run fuzz` raises the budget: `npm run fuzz -- --iterations 50000 --seed 7 [--browsers chromium,webkit] [--only INDEX] [--no-corpus]`. The seed
  is random and printed if you do not pass one. `VITE_SF_FUZZ_SEED`, `VITE_SF_FUZZ_ITERATIONS`, `VITE_SF_FUZZ_ONLY`, `VITE_SF_FUZZ_CORPUS=0` are the
  underlying variables for `vitest` directly.
- Profiles fuzzed: `article-v1`, `ui-v1`, `email-v1` (with a hostile `resolveCid`), `component-template-v1`, a derived `ui-v1` with `allowedClasses`, and a
  derived `article-v1` with `svg: "static"`, `mathml: "presentation"` and a class allowlist.

**What it found** (ADR 0008, 0010): F1, F2, F3, F4, F6 and the foreign-content parity rules, each fixed in `src/` with a regression test and a corpus
fixture; D3 and D4 documented. Local long runs on Chromium (both engines) and WebKit (DOMPurify only) after the last change: seeds 22-26 at 5,000 random
cases per profile (6 profiles), clean; seeds 1-6, 11, 12, 21 earlier, over 300,000 input/profile pairs per browser in total. Firefox runs the CI budget in CI only
(it does not launch in the maintainer's sandbox), so the long runs did not cover it.

## 8. Test inventory

Chromium: 1,002 tests in 31 files, all passing (both engines run in it); WebKit: 683 run + 70 loud skips (the native-only suites say so in their titles),
DOMPurify only. Firefox: CI only. Per file (Chromium count):

| File                                                                                                                                         |             Tests | What it is                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/unit/enforce.test.ts`                                                                                                                  |               104 | `enforceProfile`: every attribute/element rule, F1/F2, anchors, ids, `name`, parity                                                           |
| `test/unit/url-policy.test.ts`                                                                                                               |                48 | `checkUrl`: schemes, obfuscation, protocol-relative, base resolution, F6                                                                      |
| `test/unit/foreign.test.ts`                                                                                                                  |                75 | SVG/MathML: allowlists, value grammars, `use`/`href`/`xlink:href`, placement, text-only, validators, end to end                               |
| `test/unit/email.test.ts`                                                                                                                    |                35 | `cid:` and its resolver, MSO/VML, layout attributes                                                                                           |
| `test/unit/classes.test.ts`                                                                                                                  |                11 | `allowedClasses`                                                                                                                              |
| `test/unit/profiles.test.ts`, `registry.test.ts`                                                                                             |           25 + 18 | Built-in invariants; `registerProfile`/`deriveProfile` validation                                                                             |
| `test/unit/rebuild.test.ts`, `errors.test.ts`                                                                                                |             5 + 3 | Rebuild (hidden state, depth); error codes                                                                                                    |
| `test/security/xss-corpus.test.ts`                                                                                                           |                71 | Adversarial corpus (`fixtures/xss-corpus.ts`, incl. the F-series fixtures) through each engine                                                |
| `test/security/benign-corpus.test.ts`                                                                                                        |                70 | Benign corpus: ordinary content survives (a sanitizer that deletes everything fails)                                                          |
| `test/security/engine-equivalence.test.ts`                                                                                                   |                70 | Native vs DOMPurify on every XSS and benign fixture (WebKit: 69 loud skips: no native engine)                                                 |
| `test/security/email-corpus.test.ts`                                                                                                         |                67 | Email corpus, benign and hostile, both engines + equality, with a resolver                                                                    |
| `test/security/foreign-corpus.test.ts`                                                                                                       |               100 | SVG/MathML corpus: pictures, formulas, SVG attacks, namespace-confusion mXSS family; both engines + equality                                  |
| `test/security/cross-engine-values.test.ts`, `url-attributes.test.ts`, `dom-clobbering.test.ts`, `report-precision.test.ts`, `ui-v1.test.ts` | 18, 27, 17, 63, 4 | Value parity, URL attributes/`srcset`, clobbering, report precision (engine scaffolding never reported), `ui-v1`                              |
| `test/fuzz/fuzz.test.ts`                                                                                                                     |                13 | The fuzzer, CI budget                                                                                                                         |
| `test/integration/trusted-types-violations.test.ts`                                                                                          |                 3 | Zero violations under `require-trusted-types-for 'script'` (ADR 0007)                                                                         |
| `test/integration/csp-violations.test.ts`                                                                                                    |                 7 | CSP violations while parsing hostile input; pins what Chromium's parser reports (issue #13)                                                   |
| `test/integration/*` (the rest)                                                                                                              |               186 | Element lifecycle, render results, events, scope, `idPolicy`, component templates, fetch capability, DOMPurify loading, input limits, sandbox |
| `test/package/*` (Node, `npm run test:dist`)                                                                                                 |                 6 | ESM + CJS built files load together and share state; `.d.ts` augmentation; the commit installs as a git dependency                            |
| `test/examples/*` (`npm run examples`)                                                                                                       |                 - | Built examples smoke test                                                                                                                     |

Corpora: `test/fixtures/xss-corpus.ts` (about 40 entries, including the F-series), `benign-corpus.ts` (about 35), `email-corpus.ts` (6 benign, 16 hostile),
`foreign-corpus.ts` (9 benign, 24 hostile).

## 9. Open security issues

| #                                                          | Title                                                                     | State                                                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [1](https://github.com/johnhenry/safe-fragment/issues/1)   | Independent security review (this)                                        | Open; the gate for the first release                                                                                                                                  |
| [4](https://github.com/johnhenry/safe-fragment/issues/4)   | Track the Sanitizer API spec and per-browser native behavior              | Open; Chromium's `use` removal (D4) and `setHTML` behavior are examples                                                                                               |
| [5](https://github.com/johnhenry/safe-fragment/issues/5)   | DOMPurify quadratic removal cost                                          | Open; bounded by `maxInputLength`, not eliminated                                                                                                                     |
| [6](https://github.com/johnhenry/safe-fragment/issues/6)   | `article-v1`/`ui-v1` allow relative `img src` (same-origin GET on render) | Open; `blockRelativeAutoLoadUrls` opt-in; `email-v1` blocks by default                                                                                                |
| [11](https://github.com/johnhenry/safe-fragment/issues/11) | `<style>` unsupported (ADR 0006)                                          | Open as a documented non-goal; waits for this review                                                                                                                  |
| [13](https://github.com/johnhenry/safe-fragment/issues/13) | CSP reports while parsing input with `style=`, `<style>`, `<base>`        | Open: not fixable by choosing a parse context (measured in 12 contexts); pinned and documented; see [known-divergences.md](known-divergences.md#chromium-csp-reports) |

Closed by this work: #2 (`email-v1`), #3 (SVG/MathML, with the `use` divergence), #7 (class allowlist), #13 (CSP reports while parsing).

## 10. Questions for the reviewer

1. **The walk.** `enforceProfile` snapshots `fragment.querySelectorAll("*")` once, skips nodes `fragment.contains` says are gone, and unwraps with `replaceWith(...childNodes)`.
   Is there a tree shape (template contents, nested unwrap, an element moved by an earlier unwrap) where an element is never visited or is visited under
   a parent that changed since the snapshot? Elements inside `<template>` content are never visited because `template` is always dropped: is that safe for every engine?
2. **`checkUrl` vs the browser.** It resolves against a fixed HTTPS probe to tell "no authority" from "has authority", then against the document base for authority-bearing
   references, and squeezes invisible characters for a second look. Is there a parse differential between `new URL` and how a browser loads an `src`/`href`/`srcset`
   candidate/`background` that this misses (backslashes, leading C0/space, `about:`/`blob:` base documents, `http:\\host`, IDNA, userinfo, a `<base>` in the host page)?
3. **F1/F2 completeness.** The attribute-value rules copy DOMPurify's (`-->`, `--!>`, `]>`, `/>`, nine end tags; `\w+script:`/`data:`). Is "drop" right, or should `<` and `>` in
   attribute values be refused outright or escaped? Are there breakouts (`<![CDATA[`, `<?`, `&`-sequences decoded by a later parser) the serialize-and-reparse hosts of 2025-2026 still see?
4. **The DOMPurify parse prefix.** `<!DOCTYPE html><xmp></xmp>` + input, `FORCE_BODY` off. Can any input interact with the prefix (a leading `</xmp>`-like sequence, `<body>`/`<html>`
   attribute merging, a doctype in the input, a leading BOM/NUL)? Is the sentinel ever visible to `uponSanitizeElement`/the report beyond the entry that is skipped?
5. **The DOMPurify hooks.** `uponSanitizeElement` sets `allowedTags[tag] = true` for custom-element and `dropElements` names. Does that skip any DOMPurify check that matters
   (namespace validity, `SAFE_FOR_XML`) for those tags, and does `enforceProfile` cover what it skips?
6. **Rebuild.** It creates elements with `createElement(localName)` / `createElementNS` and copies attributes with `setAttribute`/`setAttributeNS`. Is a hidden node state other than a
   customized built-in's `is` value reachable (a custom element's constructor-time state, a `form`-owner, a slot assignment) that survives?
7. **Foreign content.** Are the value grammars complete and the placement rules sufficient for every namespace-confusion shape (integration points, `mglyph`/`malignmark`, `annotation-xml`
   encodings, HTML-in-SVG re-entry via `title`/`desc`, `<svg><p>` breakouts) across Chromium, WebKit and Firefox parsers? Is any allowed attribute's plain value a side effect
   (`font-family` loading, huge `stroke-dasharray`, `textLength`) worth a bound? Does `<use>` of a `symbol` that contains `<use>` of itself need a depth cap on the host side?
8. **`cid:`.** The resolver's answer is limited to `https:`, `blob:` and raster `data:`. Is `data:image/bmp|avif|webp` / `blob:` in `background=` acceptable decoder surface, and is
   handing an attacker-chosen content-id to caller code (percent-decoded, no scheme) a footgun worth a stronger interface (an allowlist of ids)?
9. **Divergences.** Is D4 (native drops `use`, DOMPurify keeps it) acceptable as documented, or should `use` be dropped everywhere for parity? Is D3 (DOMPurify over-removal) acceptable?
10. **Class and `part`.** `allowedClasses` prefix matching is `startsWith` after validation. `part` and `slot` remain unrestricted styling hooks on `component-template-v1`: same exposure class?
11. **The report.** `snippet` carries up to 60 characters of an attacker-controlled value into a diagnostic object hosts may log. Acceptable?
12. **Fuzzer gaps.** What would you add to the grammar or the oracles (a differential against a third parser, a CSS-injection oracle once `style` is considered, a layout-based UI redress oracle)?
13. **The parse realm (ADR 0012, ADR 0013).** Parsing in documents of a detached same-origin `about:blank` iframe is the only context found where Chromium's parser does not report CSP violations (an attached one inherits the page's policy and reports). Is a script-created iframe, inserted into `<html>` and removed at once, an acceptable footprint for a sanitizer? Is relying on a detached window's documents having no CSP context (Chromium behavior, not a spec guarantee) acceptable, given the test that watches every document? Does anything in a realm-owned DOMParser/DOMImplementation document differ from the page's (realm of constructors, `instanceof`, custom-element registry, Trusted Types policy per window) in a way that affects the output? Is `navigator.userAgentData` the right proxy for "the parser checks CSP"?
14. **Anything the packet does not say.** Which part of the boundary do you not trust the tests to cover?

## 11. Reproducing everything

```sh
git clone https://github.com/johnhenry/safe-fragment && cd safe-fragment
npm ci
npm run lint && npm run typecheck && npm run build
SF_BROWSERS=chromium,webkit npm test        # Firefox runs in CI; drop SF_BROWSERS if it launches for you
npm run test:dist && npm run examples && npm pack --dry-run && npm run size
npm run fuzz -- --iterations 20000 --seed 1  # a long, reproducible fuzz run
npm run examples; npx serve .                # then /examples/04-playground/: protected vs unprotected, with the report
```
