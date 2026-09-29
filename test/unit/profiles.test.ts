import { describe, it, expect } from "vitest";
import { PLAIN_TEXT_V1 } from "../../src/profiles/plain-text-v1.js";
import { ARTICLE_V1 } from "../../src/profiles/article-v1.js";
import { UI_V1 } from "../../src/profiles/ui-v1.js";
import { EMAIL_V1 } from "../../src/profiles/email-v1.js";

const ALL_PROFILES = [PLAIN_TEXT_V1, ARTICLE_V1, UI_V1, EMAIL_V1];
const DANGEROUS_SCHEMES = ["javascript:", "data:", "vbscript:", "file:"];
const DANGEROUS_ELEMENTS = ["script", "iframe", "object", "embed", "form", "svg", "math", "style", "base", "meta", "link"];

describe("shipped profile shape invariants", () => {
  for (const profile of ALL_PROFILES) {
    describe(profile.name, () => {
      it("never allows a dangerous URL scheme", () => {
        for (const scheme of DANGEROUS_SCHEMES) {
          expect(profile.urlSchemes).not.toContain(scheme);
        }
      });

      it("never allows a dangerous element", () => {
        for (const el of DANGEROUS_ELEMENTS) {
          expect(Object.keys(profile.elements)).not.toContain(el);
        }
      });

      it("never allows the style attribute", () => {
        expect(profile.allowStyleAttribute).toBe(false);
      });

      it("never lists an on*-prefixed attribute on any element", () => {
        for (const attrs of Object.values(profile.elements)) {
          for (const attr of attrs) {
            expect(attr.toLowerCase().startsWith("on")).toBe(false);
          }
        }
      });
    });
  }

  it("plain-text-v1 is a text-mode profile with zero elements/attributes/schemes", () => {
    expect(PLAIN_TEXT_V1.mode).toBe("text");
    expect(Object.keys(PLAIN_TEXT_V1.elements)).toHaveLength(0);
    expect(PLAIN_TEXT_V1.urlSchemes).toHaveLength(0);
  });

  it("only ui-v1 allows custom elements", () => {
    expect(UI_V1.allowCustomElements).toBe(true);
    expect(ARTICLE_V1.allowCustomElements).toBe(false);
    expect(EMAIL_V1.allowCustomElements).toBe(false);
    expect(PLAIN_TEXT_V1.allowCustomElements).toBe(false);
  });

  it("article-v1 and ui-v1 force rel on target=_blank anchors", () => {
    expect(ARTICLE_V1.forceRelOnBlankTarget).toBe(true);
    expect(UI_V1.forceRelOnBlankTarget).toBe(true);
  });
});
