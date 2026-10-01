import type { ProfileDefinition } from "../policy/profile.js";
import { isAllowedClassToken } from "../policy/profile.js";
import { checkUrl, hasScriptScheme } from "../policy/url.js";
import type { SanitizationNote } from "../types.js";
import {
  MATHML_ELEMENTS,
  MATHML_NAMESPACE,
  MATHML_TEXT_ONLY,
  SVG_ELEMENTS,
  SVG_NAMESPACE,
  SVG_TEXT_ONLY,
  XLINK_NAMESPACE,
  isFontFamilyList,
  isFragmentId,
  isPathData,
  isPlainValue,
  isTransformList,
  parseFragmentRef,
  parsePaint,
  type ValueKind,
} from "../policy/foreign.js";

/** What the shared pass hands the foreign-content enforcer: the profile, the notes to append to, and the helpers it shares with the HTML branch. */
export interface ForeignContext {
  profile: ProfileDefinition;
  baseUrl: string | undefined;
  /** `idPolicy: "keep-in-shadow"`: ids and references are left as written. */
  keepIds: boolean;
  idPrefix: string;
  removedElements: SanitizationNote[];
  removedAttributes: SanitizationNote[];
  rewrittenUrls: SanitizationNote[];
  snippet(value: string): string;
  splitTokens(value: string): string[];
  breaksOut(value: string): boolean;
}

/**
 * Enforces one element outside the HTML namespace (ADR 0010). Returns `true` when the
 * element stays (its attributes already enforced in place) and `false` when it was
 * removed with its whole subtree. Anything not on the profile's SVG/MathML allowlist,
 * in the wrong place, or carrying an element where only text may go, is removed with
 * everything under it: foreign content never gets the "unwrap" treatment, because
 * what is inside a disallowed foreign element may be parsed by different rules.
 */
export function enforceForeignElement(el: Element, ctx: ForeignContext): boolean {
  const ns = el.namespaceURI;
  const tag = el.localName;
  const svg = ns === SVG_NAMESPACE && ctx.profile.svg === "static";
  const math = ns === MATHML_NAMESPACE && ctx.profile.mathml === "presentation";
  const spec = svg ? SVG_ELEMENTS[tag] : math ? MATHML_ELEMENTS[tag] : undefined;
  if (spec === undefined) return drop(el, tag, "element-dropped:foreign-namespace", ctx);

  // Placement. A foreign root (<svg>, <math>) sits in HTML content (a nested <svg> may also sit in SVG); every other
  // foreign element must be a child of its own namespace's element.
  const parent = el.parentNode;
  const root = svg ? "svg" : "math";
  const parentNs = parent && parent.nodeType === 1 ? (parent as Element).namespaceURI : null;
  const parentIsForeign = parentNs === SVG_NAMESPACE || parentNs === MATHML_NAMESPACE;
  if (tag === root) {
    if (parentIsForeign && !(svg && parentNs === SVG_NAMESPACE)) return drop(el, tag, "element-dropped:foreign-misplaced", ctx);
  } else if (parentNs !== ns) {
    return drop(el, tag, "element-dropped:foreign-misplaced", ctx);
  }

  // Text integration points hold text only.
  const textOnly = svg ? SVG_TEXT_ONLY.has(tag) : MATHML_TEXT_ONLY.has(tag);
  if (textOnly) {
    for (const child of el.childNodes) {
      if (child.nodeType === 1) return drop(el, tag, "element-dropped:text-only-container", ctx);
    }
  }

  for (const attr of [...el.attributes]) enforceForeignAttribute(el, attr, tag, spec, svg, ctx);
  return true;
}

function drop(el: Element, tag: string, reason: string, ctx: ForeignContext): false {
  ctx.removedElements.push({ tag, reason });
  el.remove();
  return false;
}

function removeAttr(el: Element, attr: Attr, tag: string, reason: string, ctx: ForeignContext, list: SanitizationNote[] = ctx.removedAttributes): void {
  list.push({ tag, attribute: attr.name.toLowerCase(), reason, snippet: ctx.snippet(attr.value) });
  if (attr.namespaceURI) el.removeAttributeNS(attr.namespaceURI, attr.localName);
  else el.removeAttribute(attr.name);
}

function setValue(el: Element, attr: Attr, value: string): void {
  if (attr.namespaceURI) el.setAttributeNS(attr.namespaceURI, attr.name, value);
  else el.setAttribute(attr.name, value);
}

function enforceForeignAttribute(el: Element, attr: Attr, tag: string, spec: Readonly<Record<string, ValueKind>>, svg: boolean, ctx: ForeignContext): void {
  // The only namespaced attribute allowed is SVG's legacy xlink:href; xmlns, xml:*, other xlink:* go.
  let key = attr.name;
  if (attr.namespaceURI !== null) {
    if (svg && attr.namespaceURI === XLINK_NAMESPACE && attr.localName === "href") key = "xlink:href";
    else return removeAttr(el, attr, tag, "attribute-not-in-profile", ctx);
  } else if (attr.name === "xlink:href") {
    return removeAttr(el, attr, tag, "forbidden-attribute-class", ctx);
  }
  const lower = key.toLowerCase();
  if (lower.startsWith("on") || lower === "style" || lower === "srcdoc" || lower === "formaction" || lower === "action") {
    return removeAttr(el, attr, tag, lower === "style" ? "style-attribute-disallowed" : "forbidden-attribute-class", ctx);
  }

  const value = attr.value.trim();
  if (value !== attr.value) setValue(el, attr, value);
  if (ctx.breaksOut(value)) return removeAttr(el, attr, tag, "attribute-value-markup-breakout", ctx);

  const kind = spec[key];
  if (kind === undefined) return removeAttr(el, attr, tag, "attribute-not-in-profile", ctx);
  if (kind !== "fragment-ref" && hasScriptScheme(value)) return removeAttr(el, attr, tag, "script-scheme-in-attribute", ctx);

  const invalid = (): void => removeAttr(el, attr, tag, "foreign-attribute-value-invalid", ctx);
  const prefixed = (id: string): string => (ctx.keepIds ? id : ctx.idPrefix + id);

  switch (kind) {
    case "plain":
      if (!isPlainValue(value)) invalid();
      return;
    case "font-family":
      if (!isFontFamilyList(value)) invalid();
      return;
    case "path":
      if (!isPathData(value)) invalid();
      return;
    case "transform":
      if (!isTransformList(value)) invalid();
      return;
    case "paint":
    case "paint-ref": {
      const paint = parsePaint(value, kind === "paint");
      if (!paint.ok) return invalid();
      if (paint.refId !== undefined) setValue(el, attr, `url(#${prefixed(paint.refId)})${paint.fallback ? ` ${paint.fallback}` : ""}`);
      return;
    }
    case "fragment-ref": {
      // Every URL attribute goes through checkUrl; a reference must also be a same-fragment "#id".
      const verdict = checkUrl(value, ctx.profile.urlSchemes, ctx.baseUrl);
      if (!verdict.allowed) return removeAttr(el, attr, tag, `disallowed-url-scheme:${verdict.scheme}`, ctx, ctx.rewrittenUrls);
      const id = parseFragmentRef(value);
      if (id === undefined) return removeAttr(el, attr, tag, "foreign-reference-not-same-fragment", ctx, ctx.rewrittenUrls);
      setValue(el, attr, `#${prefixed(id)}`);
      return;
    }
    case "id":
      if (!isFragmentId(value)) return invalid();
      setValue(el, attr, prefixed(value));
      return;
    case "id-list": {
      const ids = ctx.splitTokens(value);
      if (ids.length === 0 || !ids.every(isFragmentId)) return invalid();
      setValue(el, attr, ids.map(prefixed).join(" "));
      return;
    }
    case "class": {
      const tokens = ctx.splitTokens(value);
      const kept = tokens.filter((t) => isAllowedClassToken(ctx.profile, t));
      if (kept.length !== tokens.length) {
        ctx.removedAttributes.push({
          tag,
          attribute: "class",
          reason: "class-not-allowlisted",
          snippet: ctx.snippet(tokens.filter((t) => !isAllowedClassToken(ctx.profile, t)).join(" ")),
        });
      }
      if (kept.length === 0) el.removeAttribute(attr.name);
      else if (kept.join(" ") !== attr.value) el.setAttribute(attr.name, kept.join(" "));
      return;
    }
  }
}
