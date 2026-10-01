import { describe, it, expect, afterEach } from "vitest";
import { registerProfile, unregisterProfile, deriveProfile, getProfile, listProfiles } from "../../src/policy/registry.js";
import { isSafeFragmentError } from "../../src/errors.js";
import { matchCustomElement } from "../../src/policy/profile.js";
import type { ProfileDefinition } from "../../src/policy/profile.js";

const created: string[] = [];
afterEach(() => {
  while (created.length) unregisterProfile(created.pop()!);
});

function base(overrides: Partial<ProfileDefinition> = {}): ProfileDefinition {
  return {
    name: "reg-test-v1",
    version: 1,
    mode: "html",
    elements: { p: ["id"], a: ["href"] },
    urlAttributes: [],
    urlSchemes: ["relative", "https:"],
    allowedDataAttributes: [],
    allowStyleAttribute: false,
    customElements: [],
    blockRelativeAutoLoadUrls: false,
    ...overrides,
  };
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (!isSafeFragmentError(error)) throw error; // a raw TypeError/RangeError would fail the test
    return error.code;
  }
  return undefined;
}

describe("profile registry", () => {
  it("seeds the four built-in profiles", () => {
    expect(listProfiles()).toEqual(expect.arrayContaining(["plain-text-v1", "article-v1", "ui-v1", "email-v1"]));
  });

  it("getProfile returns undefined for an unknown profile", () => {
    expect(getProfile("does-not-exist-v1")).toBeUndefined();
  });

  it("registers a new profile, deeply frozen and independent of the caller's object", () => {
    const def = base();
    const registered = registerProfile(def);
    created.push(def.name);
    expect(getProfile("reg-test-v1")).toBe(registered);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.elements)).toBe(true);
    (def.elements as Record<string, string[]>).script = ["src"]; // mutating the original afterwards changes nothing
    expect(registered.elements.script).toBeUndefined();
    expect(listProfiles()).toContain("reg-test-v1");
  });

  it("unregisterProfile removes a registered profile and reports whether it existed", () => {
    registerProfile(base());
    expect(unregisterProfile("reg-test-v1")).toBe(true);
    expect(unregisterProfile("reg-test-v1")).toBe(false);
    expect(getProfile("reg-test-v1")).toBeUndefined();
  });

  it("built-ins can be neither replaced nor unregistered, and stay unchanged", () => {
    const before = getProfile("ui-v1");
    expect(code(() => registerProfile(base({ name: "ui-v1" })))).toBe("INVALID_PROFILE");
    expect(code(() => unregisterProfile("ui-v1"))).toBe("INVALID_PROFILE");
    expect(getProfile("ui-v1")).toBe(before);
    expect(Object.isFrozen(before)).toBe(true);
  });

  it("refuses a duplicate registration until the first is unregistered", () => {
    registerProfile(base());
    created.push("reg-test-v1");
    expect(code(() => registerProfile(base()))).toBe("INVALID_PROFILE");
  });

  it("deriveProfile builds a new profile from a base WITHOUT touching the base", () => {
    const ui = getProfile("ui-v1")!;
    const derived = deriveProfile("ui-v1", {
      name: "my-ui-v1",
      customElements: [{ tag: "ui--*", attributes: ["role"] }],
      allowedDataAttributes: ["data-action", "data-id"],
    });
    const registered = registerProfile(derived);
    created.push("my-ui-v1");
    expect(registered.customElements).toHaveLength(1);
    expect(getProfile("ui-v1")).toBe(ui);
    expect(ui.customElements).toHaveLength(0);
    expect(ui.allowedDataAttributes).toEqual(["data-action"]);
  });

  describe("typed validation errors (never a raw TypeError, never a silent no-op)", () => {
    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a string", "article-v1"],
      ["an empty object", {}],
    ])("registerProfile(%s) -> INVALID_PROFILE", (_label, value) => {
      expect(code(() => registerProfile(value as unknown as ProfileDefinition))).toBe("INVALID_PROFILE");
    });

    it("rejects bad names, versions and mode", () => {
      expect(code(() => registerProfile(base({ name: "" })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ name: "Has Spaces" })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ version: 0 })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ version: 1.5 })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ mode: "xml" as "html" })))).toBe("INVALID_PROFILE");
    });

    it("PROFILE_MISMATCH when the -vN suffix disagrees with version", () => {
      expect(code(() => registerProfile(base({ name: "mismatch-v2", version: 1 })))).toBe("PROFILE_MISMATCH");
      created.push(registerProfile(base({ name: "match-v2", version: 2 })).name);
    });

    it("rejects dangerous elements, on*/style/formaction attributes, dangerous schemes, style, wildcard data-*", () => {
      expect(code(() => registerProfile(base({ elements: { script: [] } })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ elements: { svg: [] } })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ elements: { meta: [] } })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ elements: { p: ["onclick"] } })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ elements: { p: ["style"] } })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ elements: { button: ["formaction"] } })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ urlSchemes: ["relative", "javascript:"] })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ urlSchemes: ["data:"] })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ allowStyleAttribute: true })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ allowedDataAttributes: ["data-*"] })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ allowedDataAttributes: ["data-"] })))).toBe("INVALID_PROFILE");
    });

    it("custom element entries: needs a hyphen, rejects reserved names, validates patterns, no duplicates", () => {
      const ce = (...tags: string[]) => base({ customElements: tags.map((tag) => ({ tag, attributes: [] })) });
      expect(code(() => registerProfile(ce("notvalid")))).toBe("INVALID_PROFILE");
      for (const reserved of ["font-face", "annotation-xml", "color-profile", "missing-glyph", "font-face-src"]) {
        expect(code(() => registerProfile(ce(reserved)))).toBe("INVALID_PROFILE");
      }
      expect(code(() => registerProfile(ce("ui*")))).toBe("INVALID_PROFILE"); // pattern prefix needs a hyphen
      expect(code(() => registerProfile(ce("ui-*-*")))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(ce("my-widget", "my-widget")))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ customElements: [{ tag: "my-w", attributes: ["onclick"] }] })))).toBe("INVALID_PROFILE");
      expect(code(() => registerProfile(base({ customElements: [{ tag: "my-w" } as never] })))).toBe("INVALID_PROFILE");
    });

    it("deriveProfile / unregisterProfile with bad arguments throw typed errors", () => {
      expect(code(() => deriveProfile("nonexistent-v1", { name: "x-v1" }))).toBe("INVALID_PROFILE");
      expect(code(() => deriveProfile("ui-v1", {} as never))).toBe("INVALID_PROFILE");
      expect(code(() => deriveProfile("ui-v1", { name: "ui-v1" }))).toBe("INVALID_PROFILE");
      expect(code(() => unregisterProfile(undefined as never))).toBe("INVALID_PROFILE");
    });
  });

  describe("custom element prefix patterns", () => {
    const profile = base({
      customElements: [
        { tag: "ui--*", attributes: ["role"] },
        { tag: "ui--special", attributes: ["x"] },
        { tag: "my-widget", attributes: [] },
      ],
    });

    it("matches exact tags, prefix patterns, and prefers exact then the longest prefix", () => {
      expect(matchCustomElement(profile, "my-widget")?.tag).toBe("my-widget");
      expect(matchCustomElement(profile, "ui--button")?.tag).toBe("ui--*");
      expect(matchCustomElement(profile, "ui--special")?.tag).toBe("ui--special");
      expect(matchCustomElement(profile, "ui-button")).toBeUndefined();
      expect(matchCustomElement(profile, "other-thing")).toBeUndefined();
    });

    it("never matches reserved names, even for a pattern that would cover them", () => {
      const broad = base({ customElements: [{ tag: "font-*", attributes: [] }] });
      expect(matchCustomElement(broad, "font-face")).toBeUndefined();
      expect(matchCustomElement(broad, "font-awesome")?.tag).toBe("font-*");
    });
  });
});
