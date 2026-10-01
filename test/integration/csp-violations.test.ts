import { describe, it, expect, afterEach } from "vitest";
import createDOMPurify from "dompurify";
import { sanitize, sanitizeSync } from "../../src/sanitize/index.js";
import { sanitizeToFragment } from "../../src/sanitize/public.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { getProfile } from "../../src/policy/registry.js";
import type { DOMPurifyFactory } from "../../src/sanitize/dompurify.js";

// safe-fragment#13: parsing untrusted input must not report CSP violations
// (style-src-attr, style-src-elem, base-uri, img-src, ...).
//
// Measured (Chromium 14x): Chromium's own HTML parser checks the page's CSP while it parses, in EVERY document
// that shares the page's execution context (the live document, createHTMLDocument, new Document(), a template's
// content document, DOMParser documents, XML documents, shadow roots, Document.parseHTML, setHTML on a template,
// a shadow root or an SVG element: twelve contexts, all report `style-src-attr` for a `style=` attribute, connected
// or not; `style-src-elem`/`base-uri` are reported when the element is connected to the document being parsed,
// which DOMPurify's DOMParser document does). The one context that reports nothing is the initial document of a
// hidden `about:blank` iframe, so the engines parse there (ADR 0012, `inertRealm: "auto"` on Chromium):
//   * default realm: zero violations in every engine, every profile, every input below;
//   * `inertRealm: "document"` (the page's own inert document): only the irreducible directives, pinned below.

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  while (frames.length) frames.pop()!.remove();
});

const POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'none'",
  "style-src-attr 'none'",
  "style-src-elem 'none'",
  "base-uri 'none'",
  "img-src 'none'",
  "media-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types dompurify",
].join("; ");

function makeEnforcedFrame(): Promise<Document> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}"><body></body>`;
    iframe.addEventListener("load", () => resolve(iframe.contentDocument!), { once: true });
    document.body.appendChild(iframe);
    frames.push(iframe);
  });
}

function watchViolations(doc: Document): { stop(): Promise<string[]> } {
  const seen: string[] = [];
  const listener = (e: Event): void => {
    const v = e as SecurityPolicyViolationEvent;
    seen.push(`${v.violatedDirective} ${v.blockedURI} ${v.sample}`);
  };
  doc.addEventListener("securitypolicyviolation", listener);
  return {
    async stop() {
      await new Promise((r) => setTimeout(r, 150));
      doc.removeEventListener("securitypolicyviolation", listener);
      return seen;
    },
  };
}

const factory = createDOMPurify as unknown as DOMPurifyFactory;
interface Fixture {
  html: string;
  /** With `inertRealm: "document"`, Chromium reports `style-src-attr` while PARSING this (all engines). */
  styleAttr?: true;
  /** With `inertRealm: "document"`, Chromium's DOMParser document reports `style-src-elem` (DOMPurify engine only). */
  styleElem?: true;
  /** With `inertRealm: "document"`, Chromium's DOMParser document reports `base-uri` (DOMPurify engine only). */
  base?: true;
}
const INPUTS: Record<string, Fixture> = {
  "style attribute": { html: '<p style="color:red">x</p>', styleAttr: true },
  "style element": { html: "<style>p{color:red}</style><p>x</p>", styleElem: true },
  "base href": { html: '<p>x</p><base href="https://example.com/">', base: true },
  "base target": { html: '<base target="_top"><p>x</p>', base: true },
  "link stylesheet": { html: '<link rel="stylesheet" href="https://example.com/a.css"><p>x</p>' },
  "img src": { html: '<img src="https://example.com/a.png" srcset="https://example.com/b.png 2x"><p>x</p>' },
  "relative img": { html: '<img src="/logout"><p>x</p>' },
  "video poster": { html: '<video poster="https://example.com/p.png" src="https://example.com/v.mp4"></video>' },
  "iframe/object/embed": {
    html: '<iframe src="https://example.com/"></iframe><object data="https://example.com/o"></object><embed src="https://example.com/e">',
  },
  "form action": { html: '<form action="https://example.com/post"><input name=a></form>' },
  "meta refresh": { html: '<meta http-equiv="refresh" content="0;url=https://example.com/">' },
  script: { html: '<script src="https://example.com/a.js"></script><script>alert(1)</script>' },
  "inline handlers": { html: '<img src=x onerror="alert(1)"><svg onload="alert(2)"><style>*{}</style></svg>', styleElem: true },
  "svg style": { html: '<svg><style>a{fill:red}</style><rect style="fill:red"/></svg>', styleAttr: true, styleElem: true },
  math: { html: '<math><mi style="color:red">x</mi></math><p style="margin:0">y</p>', styleAttr: true },
  benign: { html: "<p>x</p>" },
};

const IS_CHROMIUM = /Chrome\//.test(navigator.userAgent);
// `inertRealm: "iframe"` is not exercised on Firefox: `auto` never uses it there (Firefox never reported), and Firefox replaces an
// iframe's initial about:blank document asynchronously, which is not worth taking on where it buys nothing (ADR 0012).
const IS_FIREFOX = /Firefox\//.test(navigator.userAgent);

/** With `inertRealm: "document"`: the only violations Chromium's own parser is allowed to report for a fixture. */
function permittedInDocumentRealm(engine: "native" | "dompurify", fx: Fixture): Set<string> {
  const ok = new Set<string>();
  if (!IS_CHROMIUM) return ok;
  if (fx.styleAttr) ok.add("style-src-attr");
  if (engine === "dompurify" && fx.styleElem) ok.add("style-src-elem");
  if (engine === "dompurify" && fx.base) ok.add("base-uri");
  return ok;
}

describe("CSP enforced: zero violations while parsing hostile input (safe-fragment#13, ADR 0012)", () => {
  it("control: the frame really reports a style attribute once it is connected", async () => {
    const doc = await makeEnforcedFrame();
    const watch = watchViolations(doc);
    const p = doc.createElement("p");
    p.setAttribute("style", "color:red");
    doc.body.appendChild(p);
    expect((await watch.stop()).length).toBeGreaterThan(0);
  });

  const ambient = hasNativeSanitizer(document) ? "native" : "dompurify";
  const engines: Array<"native" | "dompurify"> = ["dompurify"];
  if (hasNativeSanitizer(document)) engines.push("native");

  for (const realmMode of ["auto", "iframe", "document"] as const) {
    for (const engine of engines) {
      for (const profileName of ["article-v1", "ui-v1", "email-v1"]) {
        const skipped = realmMode === "iframe" && IS_FIREFOX;
        it.skipIf(skipped)(
          `inertRealm ${realmMode}, engine: ${engine}, profile: ${profileName}${skipped ? " [SKIPPED on Firefox: the iframe realm is not used there]" : ""}`,
          async () => {
            const doc = await makeEnforcedFrame();
            const profile = getProfile(profileName)!;
            const offenders: Record<string, string[]> = {};
            for (const [name, fx] of Object.entries(INPUTS)) {
              const watch = watchViolations(doc);
              const opts = { forceEngine: engine, loadDOMPurify: async () => factory, inertRealm: realmMode } as const;
              const results = [await sanitize(doc, fx.html, profile, opts), sanitizeSync(doc, fx.html, profile, opts)];
              if (engine === ambient)
                await sanitizeToFragment(fx.html, { profile: profileName, document: doc, loadDOMPurify: async () => factory, inertRealm: realmMode });
              // the parse never touches the live tree: no node of the result is connected, none belongs to the live document
              for (const r of results) {
                expect(r.fragment.ownerDocument).not.toBe(doc);
                expect([...r.fragment.querySelectorAll("*")].some((e) => e.isConnected)).toBe(false);
              }
              const allowed = realmMode === "document" ? permittedInDocumentRealm(engine, fx) : new Set<string>();
              const seen = [...new Set((await watch.stop()).map((v) => v.split(" ")[0]!))].filter((d) => !allowed.has(d));
              if (seen.length) offenders[name] = seen;
            }
            expect(offenders).toEqual({});
          },
        );
      }
    }
  }

  it.skipIf(IS_FIREFOX)("the iframe realm is one hidden, empty, scriptless frame per document, and is rebuilt if the host removes it", async () => {
    const doc = await makeEnforcedFrame();
    const profile = getProfile("article-v1")!;
    const opts = { forceEngine: "dompurify", loadDOMPurify: async () => factory, inertRealm: "iframe" } as const;
    await sanitize(doc, "<p>a</p>", profile, opts);
    await sanitize(doc, "<p>b</p>", profile, opts);
    const frames = doc.querySelectorAll("iframe[data-safe-fragment-realm]");
    if (frames.length === 0) return; // the page does not allow it: the default realm was used, which is the documented fallback
    expect(frames).toHaveLength(1);
    const frame = frames[0] as HTMLIFrameElement;
    expect(frame.hidden).toBe(true);
    expect(frame.hasAttribute("src")).toBe(false);
    expect(frame.parentElement).toBe(doc.documentElement);
    frame.remove(); // an application clearing the page
    const watch = watchViolations(doc);
    const again = await sanitize(doc, '<p style="x">c</p>', profile, opts);
    expect(again.fragment.textContent).toBe("c");
    expect(doc.querySelectorAll("iframe[data-safe-fragment-realm]")).toHaveLength(1);
    expect(await watch.stop()).toEqual([]);
  });

  it("inertRealm: document never adds an iframe", async () => {
    const doc = await makeEnforcedFrame();
    await sanitize(doc, "<p>a</p>", getProfile("article-v1")!, { forceEngine: "native", inertRealm: "document" }).catch(() => undefined);
    expect(doc.querySelectorAll("iframe")).toHaveLength(0);
  });
});
