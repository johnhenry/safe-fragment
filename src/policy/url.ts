/**
 * URL-scheme policy enforcement.
 *
 * Deliberately implemented with the platform `URL` parser, never regex.
 * Regex-based scheme checks are a classic XSS bypass vector (control
 * characters, tabs/newlines inside the scheme, mixed-case `JaVaScRiPt:`,
 * leading whitespace, etc.) -- see test/security/fixtures for concrete
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

/**
 * Checks whether `rawValue` (an attribute value taken verbatim from
 * markup) is permitted under `allowedSchemes`.
 *
 * 1. Try `new URL(rawValue)` with no base. Success means the value is
 *    genuinely absolute and its `.protocol` is authoritative -- covers
 *    `javascript:`, `data:`, `vbscript:`, `file:`, `https:`, etc,
 *    including whitespace/control-character-obfuscated variants (the
 *    parser normalizes those before recognizing the scheme).
 * 2. Otherwise, resolve against a fixed HTTPS probe base and compare both
 *    scheme AND host to the probe's own. Same scheme + same host means the
 *    value genuinely carried neither (a same-document path/query/fragment
 *    reference) -- checked against the `"relative"` allowance. A
 *    *different* host (protocol-relative `//host/path`, which inherits
 *    only the scheme, not the host, from whatever base it resolves
 *    against) is never treated as `"relative"`, even though it too has no
 *    literal scheme of its own -- it is checked against its resolved
 *    (inherited) scheme instead, since that is what it would actually
 *    become in a real document.
 * 3. Anything that fails to parse even against the probe base is rejected
 *    outright.
 */
export function checkUrl(rawValue: string, allowedSchemes: readonly string[]): UrlCheckResult {
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

  let resolved: URL;
  try {
    resolved = new URL(trimmed, PROBE_BASE);
  } catch {
    return { allowed: false, scheme: "unparseable" };
  }

  const isSameDocumentReference = resolved.protocol === PROBE_URL.protocol && resolved.host === PROBE_URL.host;
  if (isSameDocumentReference) {
    return { allowed: allowedSchemes.includes(RELATIVE), scheme: RELATIVE };
  }

  // Carries a foreign host (protocol-relative "//host/path", or otherwise
  // resolves off-origin) -- not a same-document reference. Judge it by the
  // scheme it actually resolves to, never by "relative".
  return { allowed: allowedSchemes.includes(resolved.protocol), scheme: resolved.protocol };
}

/** Conservative default URL scheme allowlist ship profiles use: relative, https, mailto. */
export const SAFE_DEFAULT_URL_SCHEMES: readonly string[] = Object.freeze([RELATIVE, "https:", "mailto:"]);

export { RELATIVE as RELATIVE_URL_SCHEME };
