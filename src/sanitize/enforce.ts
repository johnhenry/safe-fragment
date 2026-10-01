import type { ProfileDefinition } from "../policy/profile.js";
import { isAllowedClassToken, matchCustomElement } from "../policy/profile.js";
import type { SanitizationNote, IdPolicy } from "../types.js";
import { checkUrl, hasScriptScheme } from "../policy/url.js";
import { DROP_SUBTREE_ELEMENTS, HTML_NAMESPACE } from "./dangerous.js";

const SNIPPET_MAX_LENGTH = 60;
const DROP_SUBTREE: ReadonlySet<string> = new Set(DROP_SUBTREE_ELEMENTS);

/**
 * Attribute names that are never permitted on any element, regardless of
 * what a profile lists. This is a hard backstop, not the primary defense --
 * no shipped profile lists any of these, and `registerProfile` refuses to
 * register a profile that does -- but a typo or copy-paste mistake in an
 * application's custom-element attribute list (e.g. accidentally including
 * `"onclick"`) must not become exploitable. Checked case-insensitively;
 * `on*`-prefixed names are rejected as a whole class, not enumerated.
 */
const HARD_DENYLIST_ATTRS = new Set(["formaction", "srcdoc", "action", "xlink:href"]);

function isHardDenied(attrName: string): boolean {
  const lower = attrName.toLowerCase();
  return lower.startsWith("on") || HARD_DENYLIST_ATTRS.has(lower);
}

/**
 * Attribute names that are URL-valued wherever they appear, whatever the
 * profile's own `urlAttributes` says. Custom-element attribute lists are
 * application-supplied; without this a registered `<my-card src="javascript:...">`
 * would skip the scheme check entirely.
 */
const URL_VALUED_ATTRS: ReadonlySet<string> = new Set([
  "src",
  "href",
  "srcset",
  "imagesrcset",
  "poster",
  "action",
  "formaction",
  "xlink:href",
  "background",
  "ping",
  "cite",
  "data",
  "longdesc",
  "manifest",
  "codebase",
  "lowsrc",
  "dynsrc",
  "icon",
]);

/** URL-valued attributes the browser fetches as soon as the element exists (no click needed). */
const AUTO_LOAD_ATTRS: ReadonlySet<string> = new Set(["src", "srcset", "imagesrcset", "poster", "background", "data", "lowsrc", "dynsrc"]);

function isAsciiSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

/**
 * Extracts the URL of every candidate in a `srcset`/`imagesrcset` value,
 * following the HTML "parse a srcset attribute" algorithm: a URL is a run of
 * non-whitespace characters (it may itself contain commas); trailing commas
 * are stripped from it; otherwise descriptors run to the next comma that is
 * not inside parentheses. Character scan, no regex.
 */
export function parseSrcsetUrls(value: string): string[] {
  const urls: string[] = [];
  let pos = 0;
  const n = value.length;
  for (;;) {
    while (pos < n && (isAsciiSpace(value.charCodeAt(pos)) || value[pos] === ",")) pos++;
    if (pos >= n) break;
    const start = pos;
    while (pos < n && !isAsciiSpace(value.charCodeAt(pos))) pos++;
    let url = value.slice(start, pos);
    if (url.endsWith(",")) {
      while (url.endsWith(",")) url = url.slice(0, -1);
      if (url !== "") urls.push(url);
      continue;
    }
    urls.push(url);
    // Skip descriptors: up to the next comma outside parentheses.
    let depth = 0;
    while (pos < n) {
      const ch = value[pos];
      if (ch === "(") depth++;
      else if (ch === ")" && depth > 0) depth--;
      else if (ch === "," && depth === 0) break;
      pos++;
    }
  }
  return urls;
}

function splitOnWhitespace(value: string): string[] {
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= value.length; i++) {
    const ws = i === value.length || isAsciiSpace(value.charCodeAt(i));
    if (!ws && start === -1) start = i;
    else if (ws && start !== -1) {
      out.push(value.slice(start, i));
      start = -1;
    }
  }
  return out;
}

function checkUrlAttribute(
  name: string,
  value: string,
  profile: ProfileDefinition,
  baseUrl: string | undefined,
): { allowed: true } | { allowed: false; reason: string } {
  // srcset/imagesrcset hold many candidates, ping a whitespace-separated list:
  // EVERY url must pass, or the whole attribute goes. The whole value, and for
  // srcset each comma-separated segment, is checked as one URL too: splitting
  // on whitespace turns "java\tscript:x" into the harmless candidate "java",
  // but the URL parser strips the tab, so code that reads the attribute as a
  // single URL (or splits it on commas itself, as a custom element might)
  // would get javascript:.
  const isSrcset = name === "srcset" || name === "imagesrcset";
  const multi = isSrcset ? parseSrcsetUrls(value) : name === "ping" ? splitOnWhitespace(value) : null;
  const segments = isSrcset
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
    : [];
  const candidates = multi ? [...multi, ...segments, value] : [value];
  for (const candidate of candidates) {
    const result = checkUrl(candidate, profile.urlSchemes, baseUrl);
    if (!result.allowed) return { allowed: false, reason: `disallowed-url-scheme:${result.scheme}` };
    if (profile.blockRelativeAutoLoadUrls && AUTO_LOAD_ATTRS.has(name) && result.scheme === "relative") {
      return { allowed: false, reason: "relative-url-on-auto-load" };
    }
  }
  return { allowed: true };
}

/** Raw-text and RCDATA elements whose end tag, appearing inside an attribute value, can close a context a re-parse is in. */
const RAW_TEXT_CLOSER_NAMES: readonly string[] = ["style", "script", "title", "xmp", "textarea", "noscript", "iframe", "noembed", "noframes"];

function startsWithIgnoreCase(value: string, at: number, lowercaseNeedle: string): boolean {
  if (at + lowercaseNeedle.length > value.length) return false;
  for (let i = 0; i < lowercaseNeedle.length; i++) {
    const code = value.charCodeAt(at + i);
    const lower = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
    if (lower !== lowercaseNeedle.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * True when an attribute VALUE contains text that is markup to a parser in
 * some context: a comment/CDATA closer (`-->`, `--!>`, `]>`), a self-closing
 * tag end (`/>`), or the end tag of a raw-text/RCDATA element (`</style`,
 * `</noscript`, ...). Browsers that do not escape `<`/`>` in attribute values
 * when serializing (all of them before 2025, and any host that serializes
 * itself) emit the value verbatim, so a host that stores or re-inserts the
 * output can see it become markup: the classic mutation-XSS shape
 * (`<noscript><p title="</noscript><img src=x onerror=alert(1)>">`). The rule
 * is DOMPurify's (`SAFE_FOR_XML`, `ALLOW_SELF_CLOSE_IN_ATTR: false`) applied to
 * both engines so they agree; the cost is that a title like `"a --> b"` is dropped.
 * Fuzzer finding F1. Character scan, no regex.
 */
export function attributeValueBreaksOut(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "-") {
      if (startsWithIgnoreCase(value, i, "-->") || startsWithIgnoreCase(value, i, "--!>")) return true;
    } else if (ch === "]") {
      if (value[i + 1] === ">") return true;
    } else if (ch === "/") {
      if (value[i + 1] === ">") return true;
    } else if (ch === "<" && value[i + 1] === "/") {
      for (const name of RAW_TEXT_CLOSER_NAMES) if (startsWithIgnoreCase(value, i + 2, name)) return true;
    }
  }
  return false;
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

/**
 * Elements whose `name` creates named properties on `document`/`window`
 * (`img`, `form`, `embed`, `object`, `iframe`, `a`, `area`) or on their form
 * (`input`, `button`, `select`, `textarea`, `fieldset`, `output`). No built-in
 * profile allows `name` on any of them, but a derived profile can; the value is
 * then namespaced like an id (DOMPurify's `SANITIZE_DOM`, which used to drop
 * such values on one engine only, is off so both engines agree). `slot` and
 * custom elements keep their `name` verbatim: neither is clobberable, and
 * `<slot name="title">` must survive. Applies under every `idPolicy`.
 */
const CLOBBERABLE_NAME_ELEMENTS: ReadonlySet<string> = new Set([
  "a",
  "area",
  "embed",
  "form",
  "iframe",
  "img",
  "object",
  "input",
  "button",
  "select",
  "textarea",
  "fieldset",
  "output",
]);

function namespaceName(el: Element, tag: string): void {
  if (!CLOBBERABLE_NAME_ELEMENTS.has(tag)) return;
  const name = el.getAttribute("name");
  if (name === null) return;
  if (name === "") el.removeAttribute("name");
  else el.setAttribute("name", ID_PREFIX + name);
}

export interface EnforceOptions {
  /** URL of the document the fragment will be inserted into (`document.baseURI`); protocol-relative URLs inherit their scheme from it. */
  baseUrl?: string;
  /** `"prefix"` (default) namespaces ids; `"keep-in-shadow"` leaves them (caller guarantees shadow-root insertion). See `IdPolicy`. */
  idPolicy?: IdPolicy;
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
export function enforceProfile(fragment: DocumentFragment, profile: ProfileDefinition, options: EnforceOptions = {}): EnforceResult {
  const removedElements: SanitizationNote[] = [];
  const removedAttributes: SanitizationNote[] = [];
  const rewrittenUrls: SanitizationNote[] = [];

  stripComments(fragment);

  // Snapshot first: dropping an element detaches nodes we haven't visited
  // yet (their whole subtree goes with it), so re-check
  // `fragment.contains(el)` per element rather than assuming the static
  // list stays valid. Unwrapped elements' children stay in the fragment
  // and are visited later in document order.
  const elements = [...fragment.querySelectorAll<Element>("*")];

  for (const el of elements) {
    if (!fragment.contains(el)) continue; // already removed as part of an ancestor's subtree

    const tag = el.tagName.toLowerCase();

    // Foreign (SVG/MathML) elements and raw-text/embedding containers are
    // dropped with their whole subtree, whatever their tag name (an SVG
    // <a> or <title> must never be mistaken for the HTML one).
    if (el.namespaceURI !== HTML_NAMESPACE) {
      removedElements.push({ tag, reason: "element-dropped:foreign-namespace" });
      el.remove();
      continue;
    }

    const builtinAttrs = profile.elements[tag];
    const customEntry = tag.includes("-") ? matchCustomElement(profile, tag) : undefined;
    const allowedAttrs = builtinAttrs ?? customEntry?.attributes;

    if (allowedAttrs === undefined) {
      if (DROP_SUBTREE.has(tag) || (profile.dropElements?.includes(tag) ?? false)) {
        removedElements.push({ tag, reason: "element-dropped:dangerous-container" });
        el.remove();
      } else {
        // Every other non-allowed element is unwrapped: the element goes,
        // its text and (separately enforced) descendants stay. This is the
        // single cross-engine behavior; see ADR 0004.
        removedElements.push({ tag, reason: tag.includes("-") ? "element-unwrapped:custom-element-not-registered" : "element-unwrapped:not-in-profile" });
        el.replaceWith(...el.childNodes);
      }
      continue;
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();

      // DOMPurify trims every attribute value (except `value`); the native
      // engine does not. Trim here so both engines emit identical values
      // (`href=" "` vs `href=""`, `lang=" en "`).
      if (name !== "value" && attr.value !== attr.value.trim()) el.setAttribute(attr.name, attr.value.trim());

      if (isHardDenied(name)) {
        removedAttributes.push({ tag, attribute: name, reason: "forbidden-attribute-class", snippet: snippet(attr.value) });
        el.removeAttribute(attr.name);
        continue;
      }

      if (attributeValueBreaksOut(attr.value)) {
        removedAttributes.push({ tag, attribute: name, reason: "attribute-value-markup-breakout", snippet: snippet(attr.value) });
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
        // Only profile-level allowedDataAttributes (or a name the element's own
        // attribute list names explicitly) survives; no data-* wildcard.
        if (!profile.allowedDataAttributes.includes(name) && !allowedAttrs.includes(name)) {
          removedAttributes.push({ tag, attribute: name, reason: "data-attribute-not-allowlisted", snippet: snippet(attr.value) });
          el.removeAttribute(attr.name);
        } else if (hasScriptScheme(attr.value)) {
          removedAttributes.push({ tag, attribute: name, reason: "script-scheme-in-attribute", snippet: snippet(attr.value) });
          el.removeAttribute(attr.name);
        }
        continue;
      }

      if (!allowedAttrs.includes(name)) {
        removedAttributes.push({ tag, attribute: name, reason: "attribute-not-in-profile", snippet: snippet(attr.value) });
        el.removeAttribute(attr.name);
        continue;
      }

      if (name === "class") {
        // Class tokens match the host page's selectors; only the profile's allowedClasses survive (safe-fragment#7, ADR 0011).
        const tokens = splitTokens(attr.value);
        const kept = tokens.filter((t) => isAllowedClassToken(profile, t));
        if (kept.length !== tokens.length) {
          const dropped = tokens.filter((t) => !isAllowedClassToken(profile, t));
          removedAttributes.push({ tag, attribute: name, reason: "class-not-allowlisted", snippet: snippet(dropped.join(" ")) });
        }
        if (kept.length === 0) el.removeAttribute(attr.name);
        else if (kept.length !== tokens.length || kept.join(" ") !== attr.value) el.setAttribute(attr.name, kept.join(" "));
        continue;
      }

      if (URL_VALUED_ATTRS.has(name) || profile.urlAttributes.includes(name)) {
        const verdict = checkUrlAttribute(name, attr.value, profile, options.baseUrl);
        if (!verdict.allowed) {
          rewrittenUrls.push({ tag, attribute: name, reason: verdict.reason, snippet: snippet(attr.value) });
          el.removeAttribute(attr.name);
        }
      } else if (hasScriptScheme(attr.value)) {
        // Not a URL attribute, but nothing in the output may carry a script/data: value for a reader to trust (F2).
        removedAttributes.push({ tag, attribute: name, reason: "script-scheme-in-attribute", snippet: snippet(attr.value) });
        el.removeAttribute(attr.name);
      }
    }

    if (tag === "a") hardenAnchorTarget(el);
    // A <button> defaults to type=submit; force the inert kind. No profile
    // allows forms today, and `reset`/`submit` have no legitimate use in a
    // fragment that dispatches app actions via data-action.
    if (tag === "button") el.setAttribute("type", "button");
    namespaceName(el, tag);
    if (options.idPolicy !== "keep-in-shadow") namespaceIds(el);
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
