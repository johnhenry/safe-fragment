import { describe, it, expect, afterEach } from "vitest";
import createDOMPurify from "dompurify";
import { sanitize, sanitizeSync } from "../../src/sanitize/index.js";
import { sanitizeToFragment } from "../../src/sanitize/public.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { getProfile } from "../../src/policy/registry.js";
import type { DOMPurifyFactory } from "../../src/sanitize/dompurify.js";
import { watchViolationsEverywhere, type ViolationWatch } from "../helpers/csp.js";

// safe-fragment#12: under `require-trusted-types-for 'script'` sanitizing must
// not touch ANY gated sink, in any engine: a blocked sink is a
// `securitypolicyviolation` event and, with report-uri/report-to, a CSP report.

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  while (frames.length) frames.pop()!.remove();
});

function makeEnforcedFrame(): Promise<Document> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types dompurify"><body></body>`;
    iframe.addEventListener("load", () => resolve(iframe.contentDocument!), { once: true });
    document.body.appendChild(iframe);
    frames.push(iframe);
  });
}

/** Every `securitypolicyviolation` in the frame's document and in any iframe inserted into it (the parse realm's, ADR 0013). */
const watchViolations = (doc: Document): ViolationWatch => watchViolationsEverywhere(doc, 100);

const factory = createDOMPurify as unknown as DOMPurifyFactory;
const INPUTS = [
  "<p>hi</p>",
  '<p onclick="a()" style="x">t<script>evil()</script><marquee>m</marquee><img src="x" onerror="b()"><a href="javascript:c()">l</a></p><svg onload="d()"></svg>',
  "<style>p{}</style><p>after</p><div><remove>r</remove></div>",
];

describe("Trusted Types enforced: zero violations while sanitizing (safe-fragment#12)", () => {
  it("control: the frame really reports a gated sink", async () => {
    const doc = await makeEnforcedFrame();
    const watch = watchViolations(doc);
    expect(() => (doc.createElement("div").innerHTML = "<b>x</b>")).toThrow();
    expect((await watch.stop()).length).toBeGreaterThan(0);
  });

  const ambient = hasNativeSanitizer(document) ? "native" : "dompurify";
  const engines: Array<"native" | "dompurify"> = ["dompurify"];
  if (hasNativeSanitizer(document)) engines.push("native");
  for (const engine of engines) {
    it(`engine: ${engine}, sanitize / sanitizeSync / sanitizeToFragment`, async () => {
      const doc = await makeEnforcedFrame();
      const profile = getProfile("ui-v1")!;
      const watch = watchViolations(doc);
      for (const input of INPUTS) {
        await sanitize(doc, input, profile, { forceEngine: engine, loadDOMPurify: async () => factory });
        sanitizeSync(doc, input, profile, { forceEngine: engine });
        // the public API has no forceEngine: it runs the ambient engine
        if (engine === ambient) await sanitizeToFragment(input, { profile: "ui-v1", document: doc, loadDOMPurify: async () => factory });
      }
      expect(await watch.stop()).toEqual([]);
    });
  }
});
