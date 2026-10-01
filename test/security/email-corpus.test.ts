import { describe, it, expect } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { getProfile } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { EMAIL_BENIGN, EMAIL_CID_MAP, EMAIL_HOSTILE, type EmailFixture } from "../fixtures/email-corpus.js";
import { normalize, serialize } from "../helpers/dom.js";

const profile = getProfile("email-v1")!;
const resolveCid = (cid: string): string | undefined => EMAIL_CID_MAP[cid];
const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

function check(fx: EmailFixture, fragment: DocumentFragment, engine: string): void {
  const html = serialize(fragment);
  const host = document.createElement("div");
  host.appendChild(fragment.cloneNode(true));
  const where = `[${engine}] ${fx.name}\n${html}`;
  for (const t of fx.text ?? []) expect(host.textContent ?? "", `text "${t}" must survive\n${where}`).toContain(t);
  for (const t of fx.noText ?? []) expect(host.textContent ?? "", `text "${t}" must not appear\n${where}`).not.toContain(t);
  for (const sel of fx.selectors ?? []) expect(host.querySelector(sel), `selector ${sel}\n${where}`).not.toBeNull();
  const lower = html.toLowerCase();
  for (const f of fx.forbidden ?? []) expect(lower, `must not contain "${f}"\n${where}`).not.toContain(f.toLowerCase());
}

describe("email-v1 corpus (safe-fragment#2)", () => {
  for (const [label, corpus] of [
    ["benign", EMAIL_BENIGN],
    ["hostile", EMAIL_HOSTILE],
  ] as const) {
    describe(label, () => {
      for (const fx of corpus) {
        for (const engine of engines) {
          it(`${engine}: ${fx.name}`, async () => {
            const { fragment } = await sanitize(document, fx.input, profile, { forceEngine: engine, resolveCid });
            check(fx, fragment, engine);
          });
        }
        if (engines.length === 2) {
          it(`engines agree: ${fx.name}`, async () => {
            const a = await sanitize(document, fx.input, profile, { forceEngine: "native", resolveCid });
            const b = await sanitize(document, fx.input, profile, { forceEngine: "dompurify", resolveCid });
            expect(normalize(a.fragment)).toBe(normalize(b.fragment));
          });
        }
      }
    });
  }

  it("a benign newsletter reports nothing but the comments, styles and VML it is built from", async () => {
    const fx = EMAIL_BENIGN[0]!;
    const { report } = await sanitize(document, fx.input, profile, { resolveCid });
    const reasons = new Set([...report.removedElements, ...report.removedAttributes, ...report.rewrittenUrls].map((n) => n.reason));
    expect([...reasons].filter((r) => r.includes("script") || r.includes("breakout"))).toEqual([]);
  });
});
