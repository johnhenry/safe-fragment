/**
 * Elements whose entire subtree is dropped when they are not allowed
 * (ADR 0004). Everything NOT on this list that a profile does not allow is
 * *unwrapped* instead: the element goes, its allowed descendants and text
 * stay.
 *
 * The list is "raw-text / foreign-content / embedding" containers: their
 * content is either not markup at all (parsed as text, so "unwrapping" it
 * would promote attacker-chosen source text into the document), or lives
 * in a different parsing mode (`svg`, `math`, `template`), or is an
 * embedding surface (`iframe`, `object`, `embed`). Dropping the subtree is
 * the only choice that is the same in the native Sanitizer API, DOMPurify
 * and `enforceProfile`.
 *
 * Any element outside the HTML namespace (SVG/MathML descendants) is also
 * dropped with its subtree regardless of its tag name -- see enforce.ts.
 */
export const DROP_SUBTREE_ELEMENTS: readonly string[] = Object.freeze([
  "script",
  "style",
  "template",
  "noscript",
  "iframe",
  "noembed",
  "noframes",
  "xmp",
  "textarea",
  "title",
  "select",
  "object",
  "embed",
  "svg",
  "math",
  "plaintext",
  "applet",
  "frame",
  "frameset",
  "head",
]);

export const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
