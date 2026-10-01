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
// Measured result (Chromium 14x, see docs/review/known-divergences): the
// engine-independent part is fixed and pinned here -- every violation EXCEPT
// the ones below is zero in every engine, and WebKit/Firefox report nothing.
// The irreducible part is Chromium's own HTML parser:
//   * `style-src-attr`: the parser checks a `style=` attribute the moment it
//     creates the element, in ANY document that shares the page's execution
//     context (live, createHTMLDocument, template-contents, DOMParser, XML,
//     shadow root, Document.parseHTML: all measured), connected or not.
//   * `style-src-elem` / `base-uri`: checked when the element is CONNECTED to
//     its document. The native engine parses into an unconnected <div>, so it
//     never reports them; DOMPurify's DOMParser document connects them.
// Nothing short of a CSP-free realm avoids these, and a string pre-filter
// would be a regex/tokenizer sanitizer, which this project does not have.

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
  /** Chromium reports `style-src-attr` while PARSING this (all engines). */
  styleAttr?: true;
  /** Chromium's DOMParser document reports `style-src-elem` (DOMPurify engine only). */
  styleElem?: true;
  /** Chromium's DOMParser document reports `base-uri` (DOMPurify engine only). */
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

/** The only violations Chromium's own parser is allowed to report for a fixture (see the header comment). */
function permitted(engine: "native" | "dompurify", fx: Fixture): Set<string> {
  const ok = new Set<string>();
  if (!IS_CHROMIUM) return ok;
  if (fx.styleAttr) ok.add("style-src-attr");
  if (engine === "dompurify" && fx.styleElem) ok.add("style-src-elem");
  if (engine === "dompurify" && fx.base) ok.add("base-uri");
  return ok;
}

describe("CSP enforced: no avoidable violations while parsing hostile input (safe-fragment#13)", () => {
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
  for (const engine of engines) {
    for (const profileName of ["article-v1", "ui-v1", "email-v1"]) {
      it(`engine: ${engine}, profile: ${profileName}`, async () => {
        const doc = await makeEnforcedFrame();
        const profile = getProfile(profileName)!;
        const offenders: Record<string, string[]> = {};
        for (const [name, fx] of Object.entries(INPUTS)) {
          const watch = watchViolations(doc);
          const results = [
            await sanitize(doc, fx.html, profile, { forceEngine: engine, loadDOMPurify: async () => factory }),
            sanitizeSync(doc, fx.html, profile, { forceEngine: engine }),
          ];
          if (engine === ambient) await sanitizeToFragment(fx.html, { profile: profileName, document: doc, loadDOMPurify: async () => factory });
          // the parse never touches the live tree: no node of the result is connected
          for (const r of results) {
            expect(r.fragment.ownerDocument).not.toBe(doc);
            expect([...r.fragment.querySelectorAll("*")].some((e) => e.isConnected)).toBe(false);
          }
          const allowed = permitted(engine, fx);
          const seen = [...new Set((await watch.stop()).map((v) => v.split(" ")[0]!))].filter((d) => !allowed.has(d));
          if (seen.length) offenders[name] = seen;
        }
        expect(offenders).toEqual({});
      });
    }
  }
});
