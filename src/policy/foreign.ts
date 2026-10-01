/**
 * SVG and MathML allowlists (ADR 0010, safe-fragment#3). Both are opt-in per profile
 * (`svg: "static"`, `mathml: "presentation"`); without the option every element outside
 * the HTML namespace is dropped with its subtree (ADR 0004).
 *
 * "Static" means a picture: shapes, paths, text, gradients and `use` of an element of the
 * same fragment. There is deliberately no `foreignObject` (HTML inside SVG is the oldest
 * namespace-confusion door), `script`, `style`, animation (`animate`, `set`, ...: they
 * rewrite attributes, including `href`, after the sanitizer has looked), `image`, `a`,
 * filters, masks, patterns, markers, `switch`, `view`, `cursor`, fonts or metadata.
 * MathML is presentation elements only: no `annotation-xml`, `semantics`, `maction`,
 * `mglyph`, `malignmark` or `href`, which are where its mutation-XSS and link/action
 * surfaces are.
 *
 * Element and attribute names here are the DOM's own (`linearGradient`, `viewBox`): foreign
 * names are case-sensitive, unlike HTML's. Every value is checked by a character-scan
 * validator below, never by a regex; a value that does not fit its grammar removes the
 * attribute. No value may contain a backslash, quote, `;`, `:` or `/` (CSS escapes such as
 * `u\72l(` and `url(https://...)` are therefore unrepresentable), and the only function
 * that may carry a reference is `url(#id)` of this fragment.
 */

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
export const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
export const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/** How an attribute's value is validated. */
export type ValueKind =
  | "plain" // letters, digits, space, . , + - % # _  (numbers, lengths, keywords, hex colours)
  | "paint" // plain | rgb()/hsl() | url(#id) [fallback]
  | "paint-ref" // none | url(#id)
  | "path" // path data
  | "transform" // matrix()/translate()/scale()/rotate()/skewX()/skewY()
  | "fragment-ref" // #id of this fragment (href, xlink:href)
  | "id" // an id (namespaced like every id)
  | "id-list" // aria-labelledby ...
  | "class" // class tokens, filtered by allowedClasses
  | "font-family"; // names separated by commas, no quotes

const PRESENTATION: Readonly<Record<string, ValueKind>> = {
  fill: "paint",
  stroke: "paint",
  color: "paint",
  "fill-opacity": "plain",
  "fill-rule": "plain",
  "stroke-width": "plain",
  "stroke-linecap": "plain",
  "stroke-linejoin": "plain",
  "stroke-miterlimit": "plain",
  "stroke-dasharray": "plain",
  "stroke-dashoffset": "plain",
  "stroke-opacity": "plain",
  opacity: "plain",
  "clip-path": "paint-ref",
  "clip-rule": "plain",
  transform: "transform",
  display: "plain",
  visibility: "plain",
};

const IDENTITY: Readonly<Record<string, ValueKind>> = {
  id: "id",
  class: "class",
  lang: "plain",
  role: "plain",
  "aria-label": "plain",
  "aria-hidden": "plain",
  "aria-labelledby": "id-list",
  "aria-describedby": "id-list",
};

function attrs(...groups: Array<Readonly<Record<string, ValueKind>>>): Readonly<Record<string, ValueKind>> {
  return Object.freeze(Object.assign({}, ...groups));
}
function plain(...names: string[]): Readonly<Record<string, ValueKind>> {
  return Object.freeze(Object.fromEntries(names.map((n) => [n, "plain" as const])));
}

const TEXT_ATTRS: Readonly<Record<string, ValueKind>> = {
  ...plain(
    "x",
    "y",
    "dx",
    "dy",
    "rotate",
    "textLength",
    "lengthAdjust",
    "text-anchor",
    "font-size",
    "font-weight",
    "font-style",
    "dominant-baseline",
    "letter-spacing",
    "word-spacing",
    "text-decoration",
  ),
  "font-family": "font-family",
};

const SHAPE = attrs(IDENTITY, PRESENTATION, plain("pathLength"));
const GRADIENT_COMMON = attrs(IDENTITY, plain("gradientUnits", "spreadMethod"), {
  gradientTransform: "transform",
  href: "fragment-ref",
  "xlink:href": "fragment-ref",
});

/** SVG elements allowed with `svg: "static"`, each with its attribute -> value-kind map. */
export const SVG_ELEMENTS: Readonly<Record<string, Readonly<Record<string, ValueKind>>>> = Object.freeze({
  svg: attrs(IDENTITY, PRESENTATION, plain("viewBox", "width", "height", "preserveAspectRatio", "x", "y")),
  g: attrs(IDENTITY, PRESENTATION),
  defs: attrs(IDENTITY),
  symbol: attrs(IDENTITY, plain("viewBox", "preserveAspectRatio")),
  use: attrs(IDENTITY, PRESENTATION, plain("x", "y", "width", "height"), { href: "fragment-ref", "xlink:href": "fragment-ref" }),
  path: attrs(SHAPE, { d: "path" }),
  rect: attrs(SHAPE, plain("x", "y", "width", "height", "rx", "ry")),
  circle: attrs(SHAPE, plain("cx", "cy", "r")),
  ellipse: attrs(SHAPE, plain("cx", "cy", "rx", "ry")),
  line: attrs(SHAPE, plain("x1", "y1", "x2", "y2")),
  polyline: attrs(SHAPE, plain("points")),
  polygon: attrs(SHAPE, plain("points")),
  text: attrs(IDENTITY, PRESENTATION, TEXT_ATTRS),
  tspan: attrs(IDENTITY, PRESENTATION, TEXT_ATTRS),
  textPath: attrs(IDENTITY, PRESENTATION, TEXT_ATTRS, plain("startOffset", "method", "spacing", "side"), {
    href: "fragment-ref",
    "xlink:href": "fragment-ref",
  }),
  title: attrs({ id: "id" }),
  desc: attrs({ id: "id" }),
  linearGradient: attrs(GRADIENT_COMMON, plain("x1", "y1", "x2", "y2")),
  radialGradient: attrs(GRADIENT_COMMON, plain("cx", "cy", "r", "fx", "fy", "fr")),
  stop: attrs({ id: "id", offset: "plain", "stop-color": "paint", "stop-opacity": "plain" }),
  clipPath: attrs(IDENTITY, plain("clipPathUnits"), { transform: "transform" }),
});

const MATH_IDENTITY: Readonly<Record<string, ValueKind>> = {
  id: "id",
  class: "class",
  dir: "plain",
  ...plain("mathvariant", "mathsize", "mathcolor", "mathbackground", "displaystyle", "scriptlevel"),
};

/** MathML presentation elements allowed with `mathml: "presentation"`. */
export const MATHML_ELEMENTS: Readonly<Record<string, Readonly<Record<string, ValueKind>>>> = Object.freeze({
  math: attrs(MATH_IDENTITY, plain("display")),
  mrow: attrs(MATH_IDENTITY),
  mi: attrs(MATH_IDENTITY),
  mn: attrs(MATH_IDENTITY),
  mo: attrs(
    MATH_IDENTITY,
    plain("fence", "separator", "stretchy", "symmetric", "largeop", "movablelimits", "accent", "form", "lspace", "rspace", "minsize", "maxsize"),
  ),
  ms: attrs(MATH_IDENTITY),
  mtext: attrs(MATH_IDENTITY),
  mspace: attrs(MATH_IDENTITY, plain("width", "height", "depth")),
  mfrac: attrs(MATH_IDENTITY, plain("linethickness")),
  msqrt: attrs(MATH_IDENTITY),
  mroot: attrs(MATH_IDENTITY),
  msub: attrs(MATH_IDENTITY),
  msup: attrs(MATH_IDENTITY),
  msubsup: attrs(MATH_IDENTITY),
  munder: attrs(MATH_IDENTITY, plain("accentunder", "align")),
  mover: attrs(MATH_IDENTITY, plain("accent", "align")),
  munderover: attrs(MATH_IDENTITY, plain("accent", "accentunder", "align")),
  mtable: attrs(MATH_IDENTITY, plain("columnalign", "rowalign", "columnspacing", "rowspacing")),
  mtr: attrs(MATH_IDENTITY, plain("columnalign", "rowalign")),
  mtd: attrs(MATH_IDENTITY, plain("columnspan", "rowspan", "columnalign", "rowalign")),
  mpadded: attrs(MATH_IDENTITY, plain("width", "height", "depth", "lspace", "voffset")),
  mphantom: attrs(MATH_IDENTITY),
  menclose: attrs(MATH_IDENTITY, plain("notation")),
  mstyle: attrs(MATH_IDENTITY),
});

/**
 * Elements that may contain text only. In foreign content these are the HTML integration
 * points (`<svg><title>`, `<svg><desc>`) and MathML's text integration points, where the
 * parser switches back to HTML rules: an element child there is how a namespace-confusion
 * payload gets a foot in the door, so an element child removes the container.
 */
export const SVG_TEXT_ONLY: ReadonlySet<string> = new Set(["title", "desc"]);
export const MATHML_TEXT_ONLY: ReadonlySet<string> = new Set(["mi", "mn", "mo", "ms", "mtext"]);

// ---------------------------------------------------------------- value validators

function isAlnum(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}
function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;
}

/** letters, digits, space, `. , + - % # _` only. */
export function isPlainValue(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (!(isAlnum(c) || isSpace(c) || c === 0x2e || c === 0x2c || c === 0x2b || c === 0x2d || c === 0x25 || c === 0x23 || c === 0x5f)) return false;
  }
  return true;
}

/** Path data: command letters, numbers, separators. */
export function isPathData(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    const ch = value[i]!;
    const command = "MmLlHhVvCcSsQqTtAaZz".includes(ch);
    const exponent = ch === "e" || ch === "E";
    if (!(command || exponent || (c >= 0x30 && c <= 0x39) || isSpace(c) || c === 0x2e || c === 0x2c || c === 0x2b || c === 0x2d)) return false;
  }
  return true;
}

const TRANSFORM_FUNCTIONS: ReadonlySet<string> = new Set(["matrix", "translate", "scale", "rotate", "skewX", "skewY"]);

/** A transform list: known function names with number-only arguments. */
export function isTransformList(value: string): boolean {
  let i = 0;
  const n = value.length;
  while (i < n) {
    while (i < n && (isSpace(value.charCodeAt(i)) || value[i] === ",")) i++;
    if (i >= n) return true;
    let j = i;
    while (j < n && isAlnum(value.charCodeAt(j))) j++;
    const name = value.slice(i, j);
    if (!TRANSFORM_FUNCTIONS.has(name) || value[j] !== "(") return false;
    j++;
    while (j < n && value[j] !== ")") {
      const c = value.charCodeAt(j);
      const numeric = (c >= 0x30 && c <= 0x39) || isSpace(c) || c === 0x2e || c === 0x2c || c === 0x2b || c === 0x2d || value[j] === "e" || value[j] === "E";
      if (!numeric) return false;
      j++;
    }
    if (j >= n) return false;
    i = j + 1;
  }
  return true;
}

/** An id as it may appear in `#id` and `url(#id)`: letters, digits, `_`, `-`, `.`. */
export function isFragmentId(id: string): boolean {
  if (id === "") return false;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (!(isAlnum(c) || c === 0x5f || c === 0x2d || c === 0x2e)) return false;
  }
  return true;
}

/** `#id` of this fragment. Returns the id, or `undefined`. */
export function parseFragmentRef(value: string): string | undefined {
  const v = value.trim();
  if (v.length < 2 || v[0] !== "#") return undefined;
  const id = v.slice(1);
  return isFragmentId(id) ? id : undefined;
}

function startsWithAt(value: string, at: number, lowerNeedle: string): boolean {
  if (at + lowerNeedle.length > value.length) return false;
  for (let i = 0; i < lowerNeedle.length; i++) {
    const code = value.charCodeAt(at + i);
    if ((code >= 0x41 && code <= 0x5a ? code + 0x20 : code) !== lowerNeedle.charCodeAt(i)) return false;
  }
  return true;
}

/** `url(#id)` at the start of `value` (optional spaces inside): the id and the rest of the string, or `undefined`. */
function parseUrlRef(value: string): { id: string; rest: string } | undefined {
  if (!startsWithAt(value, 0, "url(")) return undefined;
  let i = 4;
  while (i < value.length && isSpace(value.charCodeAt(i))) i++;
  if (value[i] !== "#") return undefined;
  i++;
  const start = i;
  while (i < value.length && value[i] !== ")" && !isSpace(value.charCodeAt(i))) i++;
  const id = value.slice(start, i);
  while (i < value.length && isSpace(value.charCodeAt(i))) i++;
  if (value[i] !== ")" || !isFragmentId(id)) return undefined;
  return { id, rest: value.slice(i + 1) };
}

function isColorFunction(value: string): boolean {
  for (const fn of ["rgba(", "rgb(", "hsla(", "hsl("]) {
    if (!startsWithAt(value, 0, fn)) continue;
    if (value[value.length - 1] !== ")") return false;
    for (let i = fn.length; i < value.length - 1; i++) {
      const c = value.charCodeAt(i);
      if (!((c >= 0x30 && c <= 0x39) || isSpace(c) || c === 0x2e || c === 0x2c || c === 0x25 || c === 0x2b || c === 0x2d)) return false;
    }
    return true;
  }
  return false;
}

export type PaintResult = { ok: false } | { ok: true; refId?: string; fallback?: string };

/** Validates a paint value. `url(#id)` is the only reference form; the caller rewrites the id. */
export function parsePaint(raw: string, allowPlain = true): PaintResult {
  const value = raw.trim();
  if (value === "") return { ok: false };
  const ref = parseUrlRef(value);
  if (ref) {
    const fallback = ref.rest.trim();
    if (fallback !== "" && !(allowPlain && isPlainValue(fallback))) return { ok: false };
    return { ok: true, refId: ref.id, fallback: fallback || undefined };
  }
  if (!allowPlain) return value === "none" ? { ok: true } : { ok: false };
  if (isPlainValue(value) || isColorFunction(value)) return { ok: true };
  return { ok: false };
}

export function isFontFamilyList(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (!(isAlnum(c) || isSpace(c) || c === 0x2c || c === 0x2d || c === 0x5f || c === 0x2e)) return false;
  }
  return value.trim() !== "";
}
