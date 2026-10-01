import { describe, it, expect } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { deriveProfile, getProfile, registerProfile } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { FOREIGN_BENIGN, FOREIGN_HOSTILE, type ForeignFixture } from "../fixtures/foreign-corpus.js";
import { normalize, serialize } from "../helpers/dom.js";

export const RICH_PROFILE = "article-rich-test-v1";
if (!getProfile(RICH_PROFILE)) registerProfile(deriveProfile("article-v1", { name: RICH_PROFILE, svg: "static", mathml: "presentation" }));
const profile = getProfile(RICH_PROFILE)!;

const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

function check(fx: ForeignFixture, fragment: DocumentFragment, engine: string): void {
  const html = serialize(fragment);
  const host = document.createElement("div");
  host.appendChild(fragment.cloneNode(true));
  const where = `[${engine}] ${fx.name}\n${html}`;
  for (const t of fx.text ?? []) expect(host.textContent ?? "", `text "${t}"\n${where}`).toContain(t);
  for (const sel of fx.selectors ?? []) {
    if (fx.nativeDropsUse && engine === "native" && (html.includes("use") || fx.name.includes("use"))) continue;
    expect(host.querySelector(sel), `selector ${sel}\n${where}`).not.toBeNull();
  }
  for (const sel of fx.absent ?? []) expect(host.querySelector(sel), `must not match ${sel}\n${where}`).toBeNull();
  const lower = html.toLowerCase();
  for (const f of fx.forbidden ?? []) expect(lower, `must not contain "${f}"\n${where}`).not.toContain(f.toLowerCase());
}

describe("SVG / MathML corpus (safe-fragment#3)", () => {
  for (const [label, corpus] of [
    ["benign", FOREIGN_BENIGN],
    ["hostile", FOREIGN_HOSTILE],
  ] as const) {
    describe(label, () => {
      for (const fx of corpus) {
        for (const engine of engines) {
          it(`${engine}: ${fx.name}`, async () => {
            const { fragment } = await sanitize(document, fx.input, profile, { forceEngine: engine });
            check(fx, fragment, engine);
          });
        }
        if (engines.length === 2) {
          const title = `engines agree: ${fx.name}${fx.nativeDropsUse ? " [use: native drops it, so compared without it]" : ""}`;
          it(title, async () => {
            const a = await sanitize(document, fx.input, profile, { forceEngine: "native" });
            const b = await sanitize(document, fx.input, profile, { forceEngine: "dompurify" });
            if (fx.nativeDropsUse) {
              for (const f of [a.fragment, b.fragment]) for (const u of [...f.querySelectorAll("use")]) u.remove();
            }
            expect(normalize(a.fragment)).toBe(normalize(b.fragment));
          });
        }
      }
    });
  }

  it("without the opt-in every SVG and MathML element is still dropped (article-v1)", async () => {
    const plain = getProfile("article-v1")!;
    for (const fx of [...FOREIGN_BENIGN]) {
      const { fragment } = await sanitize(document, fx.input, plain);
      const host = document.createElement("div");
      host.appendChild(fragment);
      expect(host.querySelector("svg, math, path, mfrac, rect"), fx.name).toBeNull();
    }
  });
});
