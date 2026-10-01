import { describe, it, expect } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { getProfile } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { BENIGN_CORPUS } from "../fixtures/benign-corpus.js";

const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

describe("report precision: a benign input reports nothing removed (safe-fragment#9)", () => {
  for (const engine of engines) {
    describe(`engine: ${engine}`, () => {
      for (const input of ["<p>hi</p>", "<b>x</b>", "  <p>padded</p>\n", "plain text only"]) {
        it(`ui-v1 / article-v1: ${JSON.stringify(input)}`, async () => {
          for (const name of ["ui-v1", "article-v1"]) {
            const { report } = await sanitize(document, input, getProfile(name)!, { forceEngine: engine });
            expect(report.removedElements, `${name} removedElements`).toEqual([]);
            expect(report.removedAttributes, `${name} removedAttributes`).toEqual([]);
          }
        });
      }

      // Every benign fixture that does not itself expect something to vanish
      // must produce an empty report.
      for (const fixture of BENIGN_CORPUS.filter((f) => getProfile(f.profile)?.mode === "html" && !f.absent?.length)) {
        it(`benign corpus: ${fixture.name}`, async () => {
          const { report } = await sanitize(document, fixture.input, getProfile(fixture.profile)!, { forceEngine: engine });
          expect(report.removedElements).toEqual([]);
          expect(report.removedAttributes).toEqual([]);
        });
      }
    });
  }

  it("a genuine <remove> element written by the author is still reported (the wrapper DOMPurify injects is not)", async () => {
    for (const engine of engines) {
      const { report } = await sanitize(document, "<p>a</p><remove>b</remove>", getProfile("ui-v1")!, { forceEngine: engine });
      expect(
        report.removedElements.map((n) => n.tag),
        engine,
      ).toEqual(["remove"]);
    }
  });
});

describe("report parity: both engines list the same genuinely removed nodes", () => {
  const inputs: Array<[string, string]> = [
    ["unknown elements", "<p>a</p><marquee>m</marquee><blink>b</blink>"],
    ["dangerous containers", "<p>a</p><style>p{}</style><textarea>t</textarea>"],
    ["disallowed attributes", '<p style="color:red" data-x="1" foo="2">a</p>'],
    ["inside a table-less profile", "<table><tr><td>c</td></tr></table>"],
  ];
  for (const [label, input] of inputs) {
    it(label, async () => {
      if (engines.length < 2) return;
      const [d, n] = await Promise.all(engines.map((engine) => sanitize(document, input, getProfile("ui-v1")!, { forceEngine: engine })));
      const key = (x: { tag: string; attribute?: string }): string => `${x.tag}.${x.attribute ?? ""}`;
      expect(d!.report.removedElements.map(key).sort()).toEqual(n!.report.removedElements.map(key).sort());
      expect(d!.report.removedAttributes.map(key).sort()).toEqual(n!.report.removedAttributes.map(key).sort());
    });
  }
});
