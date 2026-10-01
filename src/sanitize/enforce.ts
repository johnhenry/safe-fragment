import type { ProfileDefinition, CustomElementAllowlistEntry } from "../policy/profile.js";
import type { SanitizationNote } from "../types.js";
import { checkUrl } from "../policy/url.js";

const SNIPPET_MAX_LENGTH = 60;

/**
 * Attribute names that are never permitted on any element, regardless of
 * what a profile (built-in or application-registered via `defineProfile`)
 * lists. This is a hard backstop, not the primary defense -- no shipped
 * profile lists any of these -- but `defineProfile` lets an application
 * register its own custom-element attribute list, and a typo or copy-paste
 * mistake there (e.g. accidentally including `"onclick"`) must not become
 * exploitable. Checked case-insensitively; `on*`-prefixed names are
 * rejected as a whole class, not enumerated.
 */
const HARD_DENYLIST_ATTRS = new Set(["formaction", "srcdoc", "action", "xlink:href"]);

function isHardDenied(attrName: string): boolean {
  const lower = attrName.toLowerCase();
  return lower.startsWith("on") || HARD_DENYLIST_ATTRS.has(lower);
}

function snippet(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > SNIPPET_MAX_LENGTH ? `${collapsed.slice(0, SNIPPET_MAX_LENGTH)}…` : collapsed;
}

/**
 * Prefix applied to every surviving `id` (and to every in-fragment
 * reference to one). Closes DOM clobbering: with this prefix an author can
 * never create `window.scriptUrl`, shadow `document.getElementById("app")`
 * or collide with the host page's own ids, no matter which sanitization
 * engine ran. Both engines are configured NOT to prefix on their own
 * (DOMPurify `SANITIZE_NAMED_PROPS: false`) so ids are never double-prefixed.
 */
export const ID_PREFIX = "user-content-";

/** Attributes whose value is a single id reference. */
const ID_REF_ATTRS = new Set(["for", "list", "aria-activedescendant"]);
/** Attributes whose value is a whitespace-separated list of id references. */
const ID_REF_LIST_ATTRS = new Set([
  "headers",
  "aria-controls",
  "aria-labelledby",
  "aria-describedby",
  "aria-owns",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
]);

function isAsciiWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

/** Splits on ASCII whitespace by character scan (not a regex). */
function splitTokens(value: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  for (let i = 0; i <= value.length; i++) {
    const ws = i === value.length || isAsciiWhitespace(value.charCodeAt(i));
    if (!ws && start === -1) start = i;
    else if (ws && start !== -1) {
      tokens.push(value.slice(start, i));
      start = -1;
    }
  }
  return tokens;
}

/**
 * Namespaces the element's `id` and rewrites every in-fragment id
 * reference it carries (`href="#x"`, `for`, `aria-controls`, ...) so that
 * fragment links and label/ARIA relationships keep working after the
 * prefix. Runs after the attribute allowlist, so only surviving
 * attributes are touched.
 */
function namespaceIds(el: Element): void {
  const id = el.getAttribute("id");
  if (id !== null) {
    if (id === "") el.removeAttribute("id");
    else el.setAttribute("id", ID_PREFIX + id);
  }
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name === "href") {
      const trimmed = attr.value.trim();
      if (trimmed.startsWith("#") && trimmed.length > 1) el.setAttribute(attr.name, `#${ID_PREFIX}${trimmed.slice(1)}`);
    } else if (ID_REF_ATTRS.has(name)) {
      if (attr.value !== "") el.setAttribute(attr.name, ID_PREFIX + attr.value.trim());
    } else if (ID_REF_LIST_ATTRS.has(name)) {
      el.setAttribute(
        attr.name,
        splitTokens(attr.value)
          .map((t) => ID_PREFIX + t)
          .join(" "),
      );
    }
  }
}

export interface EnforceResult {
  removedElements: SanitizationNote[];
  removedAttributes: SanitizationNote[];
  rewrittenUrls: SanitizationNote[];
}

/**
 * The authoritative allowlist enforcement pass. Runs identically after
 * either sanitization engine (native Sanitizer API or DOMPurify) so both
 * paths converge on the same final output regardless of engine-specific
 * quirks -- this is what test/security's fixture corpus asserts against
 * for both engines. Walks real DOM nodes via `querySelectorAll`/attribute
 * APIs only; contains no HTML-string parsing or regex of any kind.
 *
 * Mutates `fragment` in place and returns the notes for the
 * `SanitizationReport`.
 */
export function enforceProfile(
  fragment: DocumentFragment,
  profile: ProfileDefinition,
  customElements: ReadonlyMap<string, CustomElementAllowlistEntry>,
): EnforceResult {
  const removedElements: SanitizationNote[] = [];
  const removedAttributes: SanitizationNote[] = [];
  const rewrittenUrls: SanitizationNote[] = [];

  stripComments(fragment);

  // Snapshot first: `el.remove()` below can detach nodes we haven't
  // visited yet (their whole subtree goes with them), so re-check
  // `fragment.contains(el)` per element rather than assuming the static
  // list stays valid.
  const elements = [...fragment.querySelectorAll<Element>("*")];

  for (const el of elements) {
    if (!fragment.contains(el)) continue; // already removed as part of an ancestor's subtree

    const tag = el.tagName.toLowerCase();
    const builtinAttrs = profile.elements[tag];
    const customEntry = profile.allowCustomElements && tag.includes("-") ? customElements.get(tag) : undefined;
    const allowedAttrs = builtinAttrs ?? customEntry?.attributes;

    if (allowedAttrs === undefined) {
      removedElements.push({
        tag,
        reason: tag.includes("-") ? "custom-element-not-registered" : "element-not-in-profile",
      });
      el.remove();
      continue;
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();

      if (isHardDenied(name)) {
        removedAttributes.push({ tag, attribute: name, reason: "forbidden-attribute-class", snippet: snippet(attr.value) });
        el.removeAttribute(attr.name);
        continue;
      }

      if (name === "style") {
        if (!profile.allowStyleAttribute) {
          removedAttributes.push({ tag, attribute: name, reason: "style-attribute-disallowed", snippet: snippet(attr.value) });
          el.removeAttribute(attr.name);
        }
        continue;
      }

      if (name.startsWith("data-")) {
        if (!profile.allowDataAttributes) {
          removedAttributes.push({ tag, attribute: name, reason: "data-attributes-disallowed", snippet: snippet(attr.value) });
          el.removeAttribute(attr.name);
        }
        continue;
      }

      if (!allowedAttrs.includes(name)) {
        removedAttributes.push({ tag, attribute: name, reason: "attribute-not-in-profile", snippet: snippet(attr.value) });
        el.removeAttribute(attr.name);
        continue;
      }

      if (profile.urlAttributes.includes(name)) {
        const result = checkUrl(attr.value, profile.urlSchemes);
        if (!result.allowed) {
          rewrittenUrls.push({ tag, attribute: name, reason: `disallowed-url-scheme:${result.scheme}`, snippet: snippet(attr.value) });
          el.removeAttribute(attr.name);
        }
      }
    }

    if (tag === "a") hardenAnchorTarget(el);
    namespaceIds(el);
  }

  return { removedElements, removedAttributes, rewrittenUrls };
}

function stripComments(root: Node): void {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  let current = walker.nextNode();
  while (current) {
    comments.push(current as Comment);
    current = walker.nextNode();
  }
  for (const c of comments) c.remove();
}

/**
 * Reverse-tabnabbing defense. Only `_blank` survives as a `target` value
 * (trimmed, ASCII-lowercased, then normalized to the canonical spelling);
 * named browsing contexts (`target="victim-window"`) can navigate or
 * spoof arbitrary other windows, and `_top`/`_parent`/`_self` let hostile
 * content navigate the host page's own frame hierarchy. Whenever an anchor
 * keeps a target, `rel` is overwritten with `noopener noreferrer` -- never
 * merged with what the markup supplied, so `rel="opener"` cannot pass through.
 */
function hardenAnchorTarget(el: Element): void {
  const raw = el.getAttribute("target");
  if (raw === null) return;
  if (raw.trim().toLowerCase() === "_blank") {
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
  } else {
    el.removeAttribute("target");
  }
}
