/**
 * `cid:` (RFC 2392) names a MIME part of the message the HTML came from: the
 * inline attachment of an `<img src="cid:logo@mail">`. The library never fetches
 * anything and has no access to the message, so a `cid:` URL survives only by being
 * handed to a resolver the CALLER supplies, which returns the URL of an object it
 * already holds (typically a `blob:` URL of the attachment). The resolver's answer
 * is checked here as well: it is the one place a value that is not from the markup
 * enters the output, and a resolver written as `(cid) => base + cid` must not be
 * turned into an injection by an attacker-chosen content-id.
 */

/** Maps the content-id of a `cid:` URL (no scheme, percent-decoded) to the URL to render instead, or nothing to drop the attribute. Must not throw; if it does the attribute is dropped. */
export type CidResolver = (contentId: string) => string | null | undefined;

const CID_PREFIX_LENGTH = "cid:".length;

/** Raster image types a resolved `data:` URL may carry. SVG is excluded: it is a document. */
const DATA_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);

/** The content-id of a `cid:` URL, percent-decoded where it decodes; `undefined` when `value` is not a `cid:` URL. */
export function extractContentId(value: string): string | undefined {
  let href: string;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "cid:") return undefined;
    href = url.href;
  } catch {
    return undefined;
  }
  const rest = href.slice(CID_PREFIX_LENGTH);
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/**
 * Whether a resolver's answer may be written into `img src` / `background`:
 * `https:`, `blob:`, or a `data:` URL of a raster image type. No whitespace or
 * control characters, so what is written is what the URL parser read. Everything
 * else (`javascript:`, `http:`, `//host`, relative, `data:text/html`, SVG, `cid:`
 * again, non-strings) is refused.
 */
export function isSafeResolvedUrl(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || (c >= 0x80 && c <= 0xa0)) return false;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:" || url.protocol === "blob:") return true;
  if (url.protocol === "data:") {
    const comma = value.indexOf(",");
    if (comma === -1) return false;
    const mime = value.slice("data:".length, comma).split(";")[0]!.toLowerCase();
    return DATA_IMAGE_TYPES.has(mime);
  }
  return false;
}
