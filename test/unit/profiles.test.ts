import { describe, it, expect } from "vitest";
import { PLAIN_TEXT_V1_PROFILE } from "../../src/profiles/plain-text-v1.js";
import { ARTICLE_V1_PROFILE } from "../../src/profiles/article-v1.js";
import { UI_V1_PROFILE } from "../../src/profiles/ui-v1.js";
import { EMAIL_V1_PROFILE } from "../../src/profiles/email-v1.js";

const ALL_PROFILES = [PLAIN_TEXT_V1_PROFILE, ARTICLE_V1_PROFILE, UI_V1_PROFILE, EMAIL_V1_PROFILE];
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
    expect(PLAIN_TEXT_V1_PROFILE.mode).toBe("text");
    expect(Object.keys(PLAIN_TEXT_V1_PROFILE.elements)).toHaveLength(0);
    expect(PLAIN_TEXT_V1_PROFILE.urlSchemes).toHaveLength(0);
  });

  it("data-* is an explicit allowlist, never a wildcard", () => {
    for (const profile of ALL_PROFILES) {
      for (const name of profile.allowedDataAttributes) {
        expect(name.startsWith("data-")).toBe(true);
        expect(name.includes("*")).toBe(false);
      }
    }
    expect(UI_V1_PROFILE.allowedDataAttributes).toEqual(["data-action"]);
  });

  it("built-in profiles allow no custom elements and are versioned", () => {
    for (const profile of ALL_PROFILES) {
      expect(profile.customElements).toHaveLength(0);
      expect(profile.version).toBe(1);
      expect(profile.name.endsWith("-v1")).toBe(true);
    }
  });

  it("built-in profiles are deeply frozen", () => {
    for (const profile of ALL_PROFILES) {
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.elements)).toBe(true);
      expect(Object.isFrozen(profile.urlSchemes)).toBe(true);
      expect(Object.isFrozen(profile.allowedDataAttributes)).toBe(true);
      expect(Object.isFrozen(profile.customElements)).toBe(true);
      for (const attrs of Object.values(profile.elements)) expect(Object.isFrozen(attrs)).toBe(true);
    }
  });

  it("email-v1 blocks relative auto-load URLs; the others document the risk instead", () => {
    expect(EMAIL_V1_PROFILE.blockRelativeAutoLoadUrls).toBe(true);
    expect(ARTICLE_V1_PROFILE.blockRelativeAutoLoadUrls).toBe(false);
    expect(UI_V1_PROFILE.blockRelativeAutoLoadUrls).toBe(false);
  });
});
