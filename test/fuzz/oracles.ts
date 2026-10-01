import type { ProfileDefinition } from "../../src/policy/profile.js";
import { matchCustomElement } from "../../src/policy/profile.js";
import { checkUrl } from "../../src/policy/url.js";
import { parseSrcsetUrls } from "../../src/sanitize/enforce.js";

/**
 * Independent oracles for the mutation-XSS fuzzer. `conformance()` is a second,
 * deliberately separate implementation of "this tree is within the profile":
 * it shares only `checkUrl` and the profile data with `enforceProfile`, so a
 * bug in one is not silently mirrored in the other.
 */

const HTML_NS = "http://www.w3.org/1999/xhtml";
const ID_PREFIX = "user-content-";
const URL_ATTRS = new Set([
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
const CLOBBERABLE = new Set(["a", "area", "embed", "form", "iframe", "img", "object", "input", "button", "select", "textarea", "fieldset", "output"]);

function squeeze(value: string): string {
  let out = "";
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (
      c <= 0x20 ||
      c === 0xa0 ||
      c === 0x1680 ||
      c === 0x180e ||
      (c >= 0x2000 && c <= 0x200f) ||
      (c >= 0x2028 && c <= 0x202f) ||
      c === 0x205f ||
      c === 0x3000 ||
      c === 0xfeff
    )
      continue;
    out += ch.toLowerCase();
  }
  return out;
}

/** Independent of src/policy/url.ts: does the value, whitespace squeezed out, start with a script-ish or data: scheme? */
function scriptLike(value: string): boolean {
  const v = squeeze(value);
  return ["javascript:", "vbscript:", "livescript:", "jscript:", "ecmascript:", "data:"].some((s) => v.startsWith(s));
}

/** Independent of src/sanitize/enforce.ts: comment/CDATA closers, self-closing syntax, raw-text end tags. */
function breaksOut(value: string): boolean {
  const v = value.toLowerCase();
  if (v.includes("-->") || v.includes("--!>") || v.includes("]>") || v.includes("/>")) return true;
  return ["style", "script", "title", "xmp", "textarea", "noscript", "iframe", "noembed", "noframes"].some((n) => v.includes(`</${n}`));
}

export interface ConformanceOptions {
  baseUrl: string;
  idPolicy?: "prefix" | "keep-in-shadow";
  /** Extra per-feature rules (SVG/MathML namespaces, class allowlists, cid resolver ...). Return violation strings. */
  extra?: (el: Element, tag: string) => string[];
  /** Namespaces whose elements the caller vouches for via `extra` (default: HTML only). */
  allowedNamespaces?: ReadonlySet<string>;
}

export function conformance(root: Node, profile: ProfileDefinition, opts: ConformanceOptions): string[] {
  const out: string[] = [];
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ALL);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) continue;
    if (n.nodeType !== 1) {
      out.push(`non-element/text node type ${n.nodeType}`);
      continue;
    }
    const el = n as Element;
    const tag = el.localName;
    const ns = el.namespaceURI ?? "";
    if (ns !== HTML_NS && !(opts.allowedNamespaces?.has(ns) ?? false)) {
      out.push(`foreign-namespace element <${tag}> (${ns})`);
      continue;
    }
    const allowed = ns === HTML_NS ? (profile.elements[tag] ?? (tag.includes("-") ? matchCustomElement(profile, tag)?.attributes : undefined)) : undefined;
    if (ns === HTML_NS && allowed === undefined) {
      out.push(`element <${tag}> not in profile ${profile.name}`);
      continue;
    }
    for (const attr of el.attributes) {
      const name = attr.name;
      const lower = name.toLowerCase();
      if (ns === HTML_NS) {
        if (lower.startsWith("on")) out.push(`<${tag}> event-handler attribute ${name}`);
        else if (lower === "style" || lower === "srcdoc" || lower === "formaction" || lower === "action" || lower === "xlink:href")
          out.push(`<${tag}> forbidden attribute ${name}`);
        else if (lower.startsWith("data-")) {
          if (!profile.allowedDataAttributes.includes(lower) && !(allowed ?? []).includes(lower)) out.push(`<${tag}> data attribute ${name} not allowlisted`);
        } else if (!(allowed ?? []).includes(lower)) out.push(`<${tag}> attribute ${name} not in profile`);
        else if (name !== lower) out.push(`<${tag}> attribute ${name} not lowercase`);
        if (lower === "id" && opts.idPolicy !== "keep-in-shadow" && !attr.value.startsWith(ID_PREFIX)) out.push(`<${tag}> unprefixed id`);
        if (lower === "name" && opts.idPolicy !== "keep-in-shadow" && CLOBBERABLE.has(tag) && !attr.value.startsWith(ID_PREFIX))
          out.push(`<${tag}> unprefixed name`);
        if (lower === "class") {
          const allow = profile.allowedClasses ?? [];
          for (const token of attr.value.split(/[\t\n\f\r ]+/)) {
            const ok = allow.some((entry) => (entry.endsWith("*") ? token.startsWith(entry.slice(0, -1)) : token === entry));
            if (!ok) out.push(`<${tag}> class token ${JSON.stringify(token)} not in allowedClasses`);
          }
        }
        if (scriptLike(attr.value)) out.push(`<${tag}> ${name} carries a script/data scheme value`);
        if (breaksOut(attr.value)) out.push(`<${tag}> ${name} value can close a markup context`);
        if (attr.value !== attr.value.trim() && lower !== "value") out.push(`<${tag}> untrimmed ${name}`);
      }
      if (URL_ATTRS.has(lower) || profile.urlAttributes.includes(lower)) {
        const isSrcset = lower === "srcset" || lower === "imagesrcset";
        const candidates = isSrcset ? [...parseSrcsetUrls(attr.value), attr.value] : lower === "ping" ? attr.value.split(/\s+/) : [attr.value];
        for (const c of candidates) {
          const verdict = checkUrl(c, profile.urlSchemes, opts.baseUrl);
          if (!verdict.allowed) out.push(`<${tag}> ${name}=${JSON.stringify(c)} scheme ${verdict.scheme} not allowed`);
          else if (
            verdict.scheme === "relative" &&
            profile.blockRelativeAutoLoadUrls &&
            ["src", "srcset", "imagesrcset", "poster", "background", "data", "lowsrc", "dynsrc"].includes(lower)
          ) {
            out.push(`<${tag}> relative auto-load URL ${name}`);
          }
        }
      }
    }
    if (ns === HTML_NS) {
      if (tag === "a" && el.hasAttribute("target")) {
        if (el.getAttribute("target") !== "_blank" || el.getAttribute("rel") !== "noopener noreferrer") out.push(`<a> target without noopener noreferrer`);
      }
      if (tag === "button" && el.getAttribute("type") !== "button") out.push(`<button> not type=button`);
    }
    if (opts.extra) out.push(...opts.extra(el, tag));
  }
  return out;
}

/** Serializes a fragment with a container in the fragment's own (inert) document. */
export function serialize(fragment: DocumentFragment): string {
  const doc = fragment.ownerDocument;
  const box = doc.createElement("div");
  box.appendChild(fragment.cloneNode(true));
  return box.innerHTML;
}

/**
 * Re-parses serialized OUTPUT (never raw input) the way a host would if it
 * stored `outerHTML` and inserted it again, in an inert document with scripting
 * off. This is the mXSS round trip; it is a test oracle, the one place an HTML
 * parser sees a string outside src/sanitize/ (see AGENTS.md).
 */
export function reparse(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
  const frag = parsed.createDocumentFragment();
  frag.append(...parsed.body.childNodes);
  return frag;
}

/** Canonical form for comparing trees: merged text, sorted attributes, namespaces visible. */
export function normalize(node: Node): string {
  const parts: string[] = [];
  let pending = "";
  const flush = (): void => {
    if (pending !== "") {
      parts.push(JSON.stringify(pending));
      pending = "";
    }
  };
  for (const child of node.childNodes) {
    if (child.nodeType === 3) pending += child.nodeValue ?? "";
    else if (child.nodeType === 1) {
      flush();
      const el = child as Element;
      const attrs = [...el.attributes]
        .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
        .sort()
        .join(" ");
      parts.push(`<${el.localName}${el.namespaceURI === HTML_NS ? "" : `@${el.namespaceURI}`}${attrs ? " " + attrs : ""}>${normalize(el)}</${el.localName}>`);
    } else {
      flush();
      parts.push(`#node${child.nodeType}`);
    }
  }
  flush();
  return parts.join("");
}

/**
 * A sandboxed-by-CSP iframe used as an execution tripwire: its policy forbids
 * every script source, so ANY attempt to run script from mounted sanitizer
 * output (an event handler, a <script>, a javascript: navigation, an
 * `eval`-ish sink) is a `securitypolicyviolation`. Hooks on alert/prompt/
 * confirm/print catch the classic payload shape directly.
 */
export interface Probe {
  /** Mounts a clone of the fragment, and (if given) re-inserts its serialization the way a host that stored the HTML would. */
  mount(fragment: DocumentFragment, serialized?: string): void;
  /** Waits for deferred events (error/load handlers) and returns what fired since the last flush. */
  flush(): Promise<string[]>;
  dispose(): void;
}

const EXEC_DIRECTIVES = [
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "frame-src",
  "object-src",
  "form-action",
  "navigate-to",
  "child-src",
  "worker-src",
  "trusted-types",
  "require-trusted-types-for",
];

export function createProbe(parent: Document): Promise<Probe> {
  return new Promise((resolve) => {
    const iframe = parent.createElement("iframe");
    iframe.style.cssText = "position:fixed;left:-9999px;width:200px;height:200px";
    iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"><body><div id="root"></div></body>`;
    iframe.addEventListener(
      "load",
      () => {
        const doc = iframe.contentDocument!;
        const win = iframe.contentWindow! as unknown as Record<string, unknown>;
        let seen: string[] = [];
        for (const name of ["alert", "prompt", "confirm", "print", "eval"])
          win[name] = (...args: unknown[]) => seen.push(`${name}(${args.map(String).join(",")}) called`);
        doc.addEventListener("securitypolicyviolation", (e) => {
          const v = e as SecurityPolicyViolationEvent;
          const dir = v.effectiveDirective || v.violatedDirective;
          if (EXEC_DIRECTIVES.includes(dir)) seen.push(`CSP ${dir} ${v.blockedURI} ${v.sample}`.trim());
        });
        const root = doc.getElementById("root")!;
        resolve({
          mount(fragment, serialized) {
            const a = doc.createElement("div");
            a.appendChild(doc.importNode(fragment, true));
            root.appendChild(a);
            if (serialized !== undefined) {
              const b = doc.createElement("div");
              b.innerHTML = serialized; // oracle only: library OUTPUT, in a no-script-permitted frame
              root.appendChild(b);
            }
          },
          async flush() {
            await new Promise((r) => setTimeout(r, 30));
            const got = seen;
            seen = [];
            root.replaceChildren();
            return got;
          },
          dispose() {
            iframe.remove();
          },
        });
      },
      { once: true },
    );
    parent.body.appendChild(iframe);
  });
}
