import { describe, it, expect, afterEach } from "vitest";
import { enforceProfile } from "../../src/sanitize/enforce.js";
import { deriveProfile, registerProfile, unregisterProfile, getProfile } from "../../src/policy/registry.js";
import { sanitizeToFragment } from "../../src/sanitize/public.js";
import { UI_V1_PROFILE } from "../../src/profiles/ui-v1.js";
import { COMPONENT_TEMPLATE_V1_PROFILE } from "../../src/profiles/component-template-v1.js";
import { ARTICLE_V1_PROFILE } from "../../src/profiles/article-v1.js";
import type { ProfileDefinition } from "../../src/policy/profile.js";

// safe-fragment#7 / ADR 0011: `class` values can match the host page's selectors
// (`.admin`, `.hidden`, `.btn-danger`), so a class token survives only if the
// profile's `allowedClasses` names it (exact) or its prefix (`user-*`).

function frag(html: string): DocumentFragment {
  const t = document.createElement("template");
  t.innerHTML = html;
  const f = document.createDocumentFragment();
  while (t.content.firstChild) f.appendChild(t.content.firstChild);
  return f;
}

const registered: string[] = [];
afterEach(() => {
  while (registered.length) unregisterProfile(registered.pop()!);
});
function derived(name: string, allowedClasses: readonly string[], base = "ui-v1"): ProfileDefinition {
  const p = registerProfile(deriveProfile(base, { name, allowedClasses }));
  registered.push(name);
  return p;
}

describe("allowedClasses (safe-fragment#7, ADR 0011)", () => {
  it("ui-v1 ships with no allowed classes: class is removed (the documented safe default)", () => {
    const f = frag('<div class="admin hidden btn-danger" id="x">t</div>');
    const { removedAttributes } = enforceProfile(f, UI_V1_PROFILE);
    const div = f.firstElementChild!;
    expect(div.hasAttribute("class")).toBe(false);
    expect(div.hasAttribute("id")).toBe(true);
    expect(removedAttributes.map((n) => [n.attribute, n.reason])).toEqual([["class", "class-not-allowlisted"]]);
    expect(removedAttributes[0]!.snippet).toBe("admin hidden btn-danger");
  });

  it("component-template-v1 inherits the safe default", () => {
    const f = frag('<div class="x">t</div>');
    enforceProfile(f, COMPONENT_TEMPLATE_V1_PROFILE);
    expect(f.firstElementChild!.hasAttribute("class")).toBe(false);
  });

  it("an exact entry keeps exactly that token", () => {
    const p = derived("cls-exact-v1", ["btn", "card"]);
    const f = frag('<div class="btn admin card hidden">t</div>');
    enforceProfile(f, p);
    expect(f.firstElementChild!.getAttribute("class")).toBe("btn card");
  });

  it("a prefix entry (user-*) keeps tokens that start with the prefix", () => {
    const p = derived("cls-prefix-v1", ["user-*"]);
    const f = frag('<p class="user-a admin user-b-c  USER-d xuser-e">t</p>'.replace("<p", "<div").replace("</p>", "</div>"));
    enforceProfile(f, p);
    expect(f.firstElementChild!.getAttribute("class")).toBe("user-a user-b-c");
  });

  it("splits on every ASCII whitespace kind and normalizes the separator", () => {
    const p = derived("cls-ws-v1", ["a", "b"]);
    const el = document.createElement("div");
    el.setAttribute("class", "a\tx\nb\r\nx\fa");
    const f = document.createDocumentFragment();
    f.appendChild(el);
    enforceProfile(f, p);
    expect(el.getAttribute("class")).toBe("a b a");
  });

  it("removes the attribute when no token survives, and keeps non-class attributes", () => {
    const p = derived("cls-none-v1", ["ok"]);
    const f = frag('<div class="nope" id="i">t</div>');
    enforceProfile(f, p);
    expect(f.firstElementChild!.hasAttribute("class")).toBe(false);
    expect(f.firstElementChild!.getAttribute("id")).toBe("user-content-i");
  });

  it("is exact-match and case-sensitive (class names are)", () => {
    const p = derived("cls-case-v1", ["btn"]);
    const f = frag('<div class="BTN btn btns">t</div>');
    enforceProfile(f, p);
    expect(f.firstElementChild!.getAttribute("class")).toBe("btn");
  });

  it("does nothing for profiles that do not list class on the element (article-v1)", () => {
    const f = frag('<p class="x">t</p>');
    const { removedAttributes } = enforceProfile(f, ARTICLE_V1_PROFILE);
    expect(removedAttributes.map((n) => n.reason)).toEqual(["attribute-not-in-profile"]);
  });

  it("registerProfile validates allowedClasses", () => {
    const base = getProfile("ui-v1")!;
    for (const bad of [["*"], [""], ["a b"], ["a*b"], ["**"], ["user-*x"], [" a"], ["a\n"], [1 as unknown as string]]) {
      expect(() => registerProfile({ ...deriveProfile(base, { name: "cls-bad-v1" }), allowedClasses: bad })).toThrow(/allowedClasses/);
    }
    expect(() => registerProfile({ ...deriveProfile(base, { name: "cls-bad2-v1" }), allowedClasses: "user-*" as unknown as string[] })).toThrow(
      /allowedClasses/,
    );
  });

  it("deriveProfile keeps the base's list unless overridden, and the registered copy is frozen", () => {
    const p = derived("cls-derive-v1", ["a-*"]);
    expect(deriveProfile(p, { name: "cls-derive2-v1" }).allowedClasses).toEqual(["a-*"]);
    expect(deriveProfile(p, { name: "cls-derive3-v1", allowedClasses: [] }).allowedClasses).toEqual([]);
    expect(Object.isFrozen(p.allowedClasses)).toBe(true);
  });

  it("works end to end through sanitizeToFragment on the ambient engine", async () => {
    derived("cls-e2e-v1", ["user-*"]);
    const { fragment } = await sanitizeToFragment('<div class="user-card admin">x</div>', { profile: "cls-e2e-v1" });
    expect((fragment.firstElementChild as Element).getAttribute("class")).toBe("user-card");
    const ui = await sanitizeToFragment('<div class="user-card admin">x</div>', { profile: "ui-v1" });
    expect((ui.fragment.firstElementChild as Element).hasAttribute("class")).toBe(false);
  });
});
