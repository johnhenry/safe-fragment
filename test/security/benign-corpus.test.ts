import { describe, it, expect } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { getProfile } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { BENIGN_CORPUS } from "../fixtures/benign-corpus.js";

const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

describe("benign content survives sanitization", () => {
  for (const engine of engines) {
    describe(`engine: ${engine}`, () => {
      for (const fixture of BENIGN_CORPUS) {
        it(fixture.name, async () => {
          const profile = getProfile(fixture.profile)!;
          const { fragment } = await sanitize(document, fixture.input, profile, { forceEngine: engine });
          const host = document.createElement("div");
          host.appendChild(fragment);
          const text = host.textContent ?? "";
          for (const expected of fixture.text ?? []) {
            expect(text, `text "${expected}" must survive\n\noutput: ${host.innerHTML}`).toContain(expected);
          }
          for (const selector of fixture.selectors ?? []) {
            expect(host.querySelector(selector), `"${selector}" must survive\n\noutput: ${host.innerHTML}`).not.toBeNull();
          }
          for (const selector of fixture.absent ?? []) {
            expect(host.querySelector(selector), `"${selector}" must be gone\n\noutput: ${host.innerHTML}`).toBeNull();
          }
        });
      }
    });
  }
});
