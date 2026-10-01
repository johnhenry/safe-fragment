/**
 * URL-scheme policy enforcement.
 *
 * Deliberately implemented with the platform `URL` parser, never regex.
 * Regex-based scheme checks are a classic XSS bypass vector (control
 * characters, tabs/newlines inside the scheme, mixed-case `JaVaScRiPt:`,
 * leading whitespace, etc.) -- see test/fixtures/xss-corpus.ts for concrete
 * obfuscated payloads this approach neutralizes for free, because the
 * WHATWG URL parser strips/normalizes exactly the characters browsers'
 * own navigation algorithm strips before it ever tokenizes a scheme. A
 * value this module can't get a scheme out of is treated as blocked, never
 * as "relative" -- the allowlist is closed by construction: only an exact,
 * case-normalized scheme string (or the literal absence of one AND a
 * same-authority resolution) can match `"relative"`.
 */

const RELATIVE = "relative";

/** Placeholder base used only to make schemeless URLs parseable; never surfaced to callers. */
const PROBE_BASE = "https://safe-fragment.invalid/";
const PROBE_URL = new URL(PROBE_BASE);

export interface UrlCheckResult {
  allowed: boolean;
  /** Normalized scheme (including trailing colon), `"relative"` for same-document URLs, or `"unparseable"`. Present even when `allowed` is false, for reporting. */
  scheme: string;
}

const HIERARCHICAL_SCHEMES = new Set(["http:", "https:", "ws:", "wss:", "ftp:", "file:"]);

/** Parses `base` and returns it only if relative references (including protocol-relative ones) can genuinely resolve against it. */
function usableBase(base: string | URL | undefined): URL | null {
  if (base === undefined) return PROBE_URL;
  try {
    const parsed = typeof base === "string" ? new URL(base) : base;
    return HIERARCHICAL_SCHEMES.has(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Checks whether `rawValue` (an attribute value taken verbatim from
 * markup) is permitted under `allowedSchemes`.
 *
 * `base` is the URL of the document the markup will be inserted into
 * (`document.baseURI`). It only matters for authority-bearing relative
 * references -- protocol-relative `//host/x` and its backslash variants
 * (`\\host`, `/\\host`, `\\/host`; the WHATWG parser treats `\` as `/` for
 * special schemes) -- which inherit their *scheme* from the document, so an
 * `http:` page turns `//evil.example/x` into `http://evil.example/x`, never
 * `https:`. When `base` is omitted a fixed HTTPS probe is used (pure-function
 * callers, tests); when `base` is supplied but not a usable hierarchical URL
 * (`about:blank`, `data:`, unparseable) an authority-bearing reference
 * cannot be resolved and is rejected as `"unparseable"` (fail closed).
 *
 * 1. Try `new URL(rawValue)` with no base. Success means the value is
 *    genuinely absolute and its `.protocol` is authoritative -- covers
 *    `javascript:`, `data:`, `vbscript:`, `file:`, `https:`, etc,
 *    including whitespace/control-character-obfuscated variants (the
 *    parser normalizes those before recognizing the scheme).
 * 2. Otherwise, resolve against the fixed probe and compare scheme AND
 *    host: unchanged means the value carried neither (a same-document
 *    path/query/fragment reference), checked against the `"relative"`
 *    allowance.
 * 3. A different host means an authority-bearing reference; it is
 *    re-resolved against the real `base` and judged by the scheme it
 *    actually inherits there, never by `"relative"`.
 * 4. Anything that fails to parse is rejected outright.
 */
export function checkUrl(rawValue: string, allowedSchemes: readonly string[], base?: string | URL): UrlCheckResult {
  const result = checkUrlOnce(rawValue, allowedSchemes, base);
  if (!result.allowed) return result;
  // Defense in depth, and parity with DOMPurify: a value that only becomes a
  // disallowed scheme once whitespace, control and format characters are
  // removed (`java script:`, `javascript&#8203;:`) is rejected, even though a
  // browser's URL parser would treat the original as a harmless relative
  // reference. The two engines then agree, and a parser that is more lenient
  // than WHATWG's cannot be exploited through such a value.
  const squeezed = removeInvisible(rawValue);
  if (squeezed !== rawValue.trim()) {
    const stricter = checkUrlOnce(squeezed, allowedSchemes, base);
    if (!stricter.allowed) return stricter;
  }
  return result;
}

/** Characters DOMPurify strips from a URL attribute before judging its scheme: C0 controls, spaces, and Unicode space/format characters. */
function isInvisibleUrlChar(code: number): boolean {
  return code <= 0x20 || code === 0xa0 || code === 0x1680 || code === 0x180e || (code >= 0x2000 && code <= 0x2029) || code === 0x205f || code === 0x3000;
}

function removeInvisible(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (!isInvisibleUrlChar(value.charCodeAt(i))) out += value[i];
  }
  return out;
}

function checkUrlOnce(rawValue: string, allowedSchemes: readonly string[], base?: string | URL): UrlCheckResult {
  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { allowed: allowedSchemes.includes(RELATIVE), scheme: RELATIVE };
  }

  try {
    const absolute = new URL(trimmed);
    return { allowed: allowedSchemes.includes(absolute.protocol), scheme: absolute.protocol };
  } catch {
    // Not parseable as absolute -- fall through to relative resolution.
  }

  let probed: URL;
  try {
    probed = new URL(trimmed, PROBE_BASE);
  } catch {
    return { allowed: false, scheme: "unparseable" };
  }

  if (probed.protocol === PROBE_URL.protocol && probed.host === PROBE_URL.host) {
    return { allowed: allowedSchemes.includes(RELATIVE), scheme: RELATIVE };
  }

  const realBase = usableBase(base);
  if (!realBase) return { allowed: false, scheme: "unparseable" };
  let resolved: URL;
  try {
    resolved = new URL(trimmed, realBase);
  } catch {
    return { allowed: false, scheme: "unparseable" };
  }
  return { allowed: allowedSchemes.includes(resolved.protocol), scheme: resolved.protocol };
}

function isWordChar(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f;
}

/**
 * True when `rawValue` starts, once whitespace/control/format characters are
 * removed, with `data:` or with a word that ends in `script` followed by `:`
 * (`javascript:`, `vbscript:`, `livescript:`, `avascript:` ...). This is
 * DOMPurify's own rule for values of non-URL attributes (`^(?:\w+script|data):`)
 * applied to both engines so they agree; the cost is that a value such as
 * `"transcript: ..."` is dropped too. Used on attributes that are NOT URLs
 * (`title`, `lang`, a custom element's own): such a value is inert until something
 * reads it as a URL, and nothing in a sanitizer's output should be one. Character
 * scan, no regex.
 */
export function hasScriptScheme(rawValue: string): boolean {
  const v = removeInvisible(rawValue);
  let i = 0;
  while (i < v.length && isWordChar(v.charCodeAt(i))) i++;
  if (i === 0 || v[i] !== ":") return false;
  const word = v.slice(0, i).toLowerCase();
  return word === "data" || (word.length > "script".length && word.endsWith("script"));
}

/** Conservative default URL scheme allowlist ship profiles use: relative, https, mailto. */
export const SAFE_DEFAULT_URL_SCHEMES: readonly string[] = Object.freeze([RELATIVE, "https:", "mailto:"]);

export { RELATIVE as RELATIVE_URL_SCHEME };
