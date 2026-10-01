import { describe, it, expect } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { getProfile } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { XSS_CORPUS } from "../fixtures/xss-corpus.js";

function serialize(fragment: DocumentFragment): string {
  const div = document.createElement("div");
  div.appendChild(fragment.cloneNode(true));
  return div.innerHTML;
}

const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

describe(`adversarial XSS corpus (native supported in this browser: ${hasNativeSanitizer(document)})`, () => {
  for (const engine of engines) {
    describe(`engine: ${engine}`, () => {
      for (const fixture of XSS_CORPUS) {
        it(fixture.name, async () => {
          const profile = getProfile(fixture.profile);
          expect(profile, `profile "${fixture.profile}" must exist`).toBeTruthy();

          const { fragment } = await sanitize(document, fixture.input, profile!, { forceEngine: engine });
          const html = serialize(fragment);
          const lower = html.toLowerCase();

          for (const forbidden of fixture.forbiddenSubstrings) {
            expect(lower, `output must not contain "${forbidden}"\n\noutput: ${html}`).not.toContain(forbidden.toLowerCase());
          }

          const host = document.createElement("div");
          host.appendChild(fragment.cloneNode(true));
          for (const text of fixture.survives ?? []) {
            expect(host.textContent ?? "", `benign text "${text}" must survive sanitization\n\noutput: ${html}`).toContain(text);
          }

          for (const { selector, attribute } of fixture.forbiddenAttributes ?? []) {
            const container = document.createElement("div");
            container.appendChild(fragment.cloneNode(true));
            for (const el of container.querySelectorAll(selector)) {
              expect(el.hasAttribute(attribute), `<${selector}> must not carry "${attribute}"\n\noutput: ${html}`).toBe(false);
            }
          }
        });
      }
    });
  }

  it("target=_blank anchors get rel=noopener noreferrer forced (article-v1)", async () => {
    const profile = getProfile("article-v1")!;
    const { fragment } = await sanitize(document, '<a href="https://good.example/" target="_blank">x</a>', profile);
    const div = document.createElement("div");
    div.appendChild(fragment);
    const a = div.querySelector("a")!;
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
