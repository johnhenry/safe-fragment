import { describe, it, expect } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { getProfile } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { XSS_CORPUS } from "../fixtures/xss-corpus.js";
import { BENIGN_CORPUS } from "../fixtures/benign-corpus.js";
import { normalize } from "../helpers/dom.js";

const native = hasNativeSanitizer(document);

// The equivalence claim needs two engines. Where the browser has no native
// Sanitizer API (WebKit/Safari today) the suite is skipped LOUDLY, with the
// reason in the title, instead of passing vacuously.
const suite = native ? describe : describe.skip;
const title = native
  ? "cross-engine equivalence: native Sanitizer API vs DOMPurify produce the same DOM"
  : "cross-engine equivalence [SKIPPED: this browser has no native Sanitizer API (Element.setHTML), so DOMPurify is the only engine and there is nothing to compare]";

const cases = [
  ...XSS_CORPUS.map((f) => ({ source: "xss", name: f.name, profile: f.profile, input: f.input })),
  ...BENIGN_CORPUS.filter((f) => getProfile(f.profile)?.mode === "html").map((f) => ({ source: "benign", name: f.name, profile: f.profile, input: f.input })),
];

suite(title, () => {
  for (const c of cases) {
    it(`[${c.source}] ${c.name}`, async () => {
      const profile = getProfile(c.profile)!;
      const a = await sanitize(document, c.input, profile, { forceEngine: "native" });
      const b = await sanitize(document, c.input, profile, { forceEngine: "dompurify" });
      expect(normalize(a.fragment)).toBe(normalize(b.fragment));
    });
  }
});

describe("cross-engine equivalence bookkeeping", () => {
  it("covers the whole XSS corpus plus the benign corpus", () => {
    expect(cases.length).toBeGreaterThanOrEqual(XSS_CORPUS.length + 30);
  });
});
