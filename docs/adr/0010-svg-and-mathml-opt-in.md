# ADR 0010: SVG and MathML are opt-in subsets, enforced by `enforceProfile`

## Status

Accepted. Resolves safe-fragment#3 (except that `<use>` is not equally supported on both engines: see "Where it is not equal").

## Context

Until now every element outside the HTML namespace was dropped with its subtree (ADR 0004). SVG and MathML are real needs (icons, charts, formulas) and also the home of the
mutation-XSS family: the parser switches rules at `<svg>`/`<math>`, and `<foreignObject>`, `<desc>`, `<title>`, `<mi>`, `<mtext>`, `<annotation-xml>` switch it back, so a
sanitizer and a later re-parse can disagree about which namespace a node is in and which text is markup. Every DOMPurify bypass of 2019-2020 was of this shape. SVG also has
script-carrying elements, attributes that load, and animation that rewrites `href` after the sanitizer has looked.

## Decision

**Two opt-in profile options, nothing on by default.** `ProfileDefinition.svg: "static"` and `ProfileDefinition.mathml: "presentation"`. No built-in sets them; a caller derives
a profile (`deriveProfile("article-v1", { name: "my-article-v1", svg: "static", mathml: "presentation" })`). Without the option every foreign element is dropped as before.

**`svg: "static"` is a picture.** Allowed: `svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath title desc linearGradient radialGradient stop clipPath`,
each with its own attribute list (`src/policy/foreign.ts`). Not allowed, ever, under this option: `foreignObject`, `script`, `style`, every animation element (`animate`,
`set`, `animateTransform`, `animateMotion`, `discard`), `image`, `a`, `filter` and `fe*`, `mask`, `pattern`, `marker`, `switch`, `view`, `cursor`, fonts, `metadata`, and every event,
`style`, `xmlns*`, `xml:*` and other namespaced attribute. `class` goes through `allowedClasses` (ADR 0011); ids are namespaced like every id.

**`mathml: "presentation"` is presentation elements only:** `math mrow mi mn mo ms mtext mspace mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mtd mpadded mphantom
menclose mstyle`. No `annotation`, `annotation-xml`, `semantics`, `maction`, `mglyph`, `malignmark`, no `href`/`xlink:href`, no `style`.

**Every value is validated by a character-scan grammar, not a denylist** (`src/policy/foreign.ts`). A plain value is letters, digits, space and `. , + - % # _`; path data is command
letters and numbers; a transform list is `matrix/translate/scale/rotate/skewX/skewY` with number arguments; a font family is names and commas. A value that does not fit removes the
attribute. No value can contain a backslash, a quote, `;`, `:`, `/` or `*`, so CSS escapes (`u\72l(`), `url(https://...)`, comments and `javascript:` are unrepresentable. The one
reference form is `url(#id)` (paint, `clip-path`) or `#id` (`href`, `xlink:href`) of **this fragment**, with the id rewritten to the namespaced one and an optional plain fallback.
`href`/`xlink:href` also go through `checkUrl` (a profile with no `relative` scheme refuses even `#id`), then must be `#id`; `xlink:href` is kept only as a real XLink-namespace attribute
on SVG elements (written with `setAttributeNS`, so the rebuild never leaves a null-namespace `xlink:href`).

**Placement.** A foreign root (`svg`, `math`) lives in HTML content (a nested `svg` may also live in `svg`); every other foreign element must be a child of its own namespace; `math`
in `svg` or `svg` in `math` goes; an HTML element parented to a foreign element goes. `title`, `desc` and the MathML token elements (`mi mn mo ms mtext`) hold text only: element
descendants never stay (an allowed one is removed with its content, an unknown one is unwrapped, a raw-text/dangerous one is dropped, which is also what DOMPurify does with the same input,
so the engines agree).

**Disallowed elements of an opted-in namespace follow ADR 0004.** Containers of non-presentation content are dropped with their subtree: the shared drop list gained `foreignobject`,
`annotation`, `annotation-xml`, `animate`, `animatetransform`, `animatemotion`, `set`, `metadata` (every engine and `enforceProfile` use the same list; an HTML-context element of such a
name is an unknown element that is now dropped with its content too). Everything else not allowed (`a`, `switch`, `mask`, `filter`, `maction`, `semantics`, `mglyph`...) is
unwrapped: its element goes, its allowed descendants stay. An HTML-namespace element carrying an opted-in foreign name (`<mi>` or `<path>` outside `<svg>`/`<math>`) is dropped with its
content, because DOMPurify does that once the name is in its allowlist.

**Engine configuration.** The engines are told only what they need: DOMPurify's allowlist gets the lowercase names; the native engine's attribute list gets the DOM's case-sensitive
spellings (`viewBox`, `gradientUnits`: the Sanitizer API matches case-sensitively and silently drops the lowercase variants) and the namespaced `xlink:href`; `svg` and `math` come off the
native engine's `removeElements` for opted-in profiles (it matches them in the foreign namespace too). The rebuild creates foreign elements with `createElementNS` and attributes with
`setAttributeNS`. `enforceProfile` is still the boundary: both engines' output goes through the same code, and a foreign element is never trusted for being foreign.

## Where it is not equal

- **`<use>` is removed unconditionally by the native engine** (Chromium; the Sanitizer API's built-in baseline, whatever the config says). DOMPurify keeps a same-fragment `use`. So `use`
  works where DOMPurify is the engine (Safari, and any browser with the fallback forced) and is dropped where the native engine runs. This is safe, not equal; it is documented as D4, and
  the corpus and the fuzzer compare the engines with `use` taken out of both. Do not depend on `use` across browsers.
- DOMPurify's own mXSS heuristic over-removes an element in rare shapes (D3, ADR 0008); that is not specific to SVG.

## Consequences

- `docs/profiles.md` documents the recipe, the allowlists, and the limits (no `style`, so SVG without `fill` attributes is black; no animation; no `image`; `use` per above).
- `test/fixtures/foreign-corpus.ts`: benign pictures and formulas, and an adversarial corpus of SVG attacks and the namespace-confusion mXSS family (foreign-content breakouts through
  `<style>`, `<textarea>`, `<title>`, `<mglyph>`, `annotation-xml`, attribute values closing raw-text elements, CDATA, PIs). Both engines, compared.
- The fuzzer runs a profile with both options (`fuzz-rich-v1`), seeded with both corpora and grammar fragments for namespace switches, with an independent verifier of the foreign
  allowlists, namespaces, placement and value grammars.
- Firefox runs the same suites in CI (it was not available to run locally); a native-engine difference there would show as a failing equivalence test.
