import { describe, it, expect } from "vitest";
import { enforceProfile } from "../../src/sanitize/enforce.js";
import { ARTICLE_V1 } from "../../src/profiles/article-v1.js";
import { UI_V1 } from "../../src/profiles/ui-v1.js";
import { PLAIN_TEXT_V1 } from "../../src/profiles/plain-text-v1.js";

function fragmentFromHtml(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  const frag = document.createDocumentFragment();
  while (template.content.firstChild) frag.appendChild(template.content.firstChild);
  return frag;
}

function serialize(fragment: DocumentFragment): string {
  const div = document.createElement("div");
  div.appendChild(fragment.cloneNode(true));
  return div.innerHTML;
}

describe("enforceProfile", () => {
  it("removes elements not in the profile, subtree and all", () => {
    const frag = fragmentFromHtml("<p>keep</p><script>evil()</script>");
    const { removedElements } = enforceProfile(frag, ARTICLE_V1, new Map());
    expect(serialize(frag)).toBe("<p>keep</p>");
    expect(removedElements.some((n) => n.tag === "script")).toBe(true);
  });

  it("removes attributes not allowlisted for the element", () => {
    const frag = fragmentFromHtml('<p data-foo="bar" onclick="evil()">x</p>');
    enforceProfile(frag, ARTICLE_V1, new Map());
    const p = frag.firstElementChild!;
    expect(p.hasAttribute("data-foo")).toBe(false); // article-v1 does not allow data-*
    expect(p.hasAttribute("onclick")).toBe(false);
  });

  it("keeps data-* attributes when the profile allows them (ui-v1)", () => {
    const frag = fragmentFromHtml('<div data-action="go">x</div>');
    enforceProfile(frag, UI_V1, new Map());
    const div = frag.firstElementChild!;
    expect(div.getAttribute("data-action")).toBe("go");
  });

  it("always strips on* attributes even on allowed elements, regardless of profile config", () => {
    const frag = fragmentFromHtml('<div onclick="evil()" onmouseover="evil()">x</div>');
    enforceProfile(frag, UI_V1, new Map());
    const div = frag.firstElementChild!;
    expect(div.hasAttribute("onclick")).toBe(false);
    expect(div.hasAttribute("onmouseover")).toBe(false);
  });

  it("strips disallowed URL schemes from href", () => {
    const frag = fragmentFromHtml('<a href="javascript:evil()">x</a>');
    const { rewrittenUrls } = enforceProfile(frag, ARTICLE_V1, new Map());
    const a = frag.firstElementChild!;
    expect(a.hasAttribute("href")).toBe(false);
    expect(rewrittenUrls.length).toBe(1);
  });

  it("keeps allowed URL schemes", () => {
    const frag = fragmentFromHtml('<a href="https://example.com/">x</a>');
    enforceProfile(frag, ARTICLE_V1, new Map());
    const a = frag.firstElementChild!;
    expect(a.getAttribute("href")).toBe("https://example.com/");
  });

  it("forces rel=noopener noreferrer on target=_blank anchors", () => {
    const frag = fragmentFromHtml('<a href="https://example.com/" target="_blank" rel="evil">x</a>');
    enforceProfile(frag, ARTICLE_V1, new Map());
    const a = frag.firstElementChild!;
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  describe("anchor target hardening (reverse tabnabbing)", () => {
    function anchor(html: string, profile = ARTICLE_V1): Element {
      const frag = fragmentFromHtml(html);
      enforceProfile(frag, profile, new Map());
      return frag.firstElementChild!;
    }

    it("drops named browsing-context targets", () => {
      const a = anchor('<a href="https://x.example/" target="victim-window">x</a>');
      expect(a.hasAttribute("target")).toBe(false);
    });

    it.each(["_top", "_parent", "_self", "_TOP", ""])("drops target=%j", (t) => {
      const a = anchor(`<a href="https://x.example/" target="${t}">x</a>`);
      expect(a.hasAttribute("target")).toBe(false);
    });

    it.each(["_BLANK", " _blank", "_Blank\t", "_blank"])("normalizes target=%j to _blank and forces rel", (t) => {
      const a = anchor(`<a href="https://x.example/" target="${t}" rel="opener">x</a>`);
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("never lets attacker rel through when a target is kept (ui-v1)", () => {
      const a = anchor('<a href="https://x.example/" target="_blank" rel="opener noreferrer">x</a>', UI_V1);
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    });
  });

  it("strips the style attribute unconditionally (no v1 profile allows it)", () => {
    const frag = fragmentFromHtml('<p style="color:red">x</p>');
    enforceProfile(frag, ARTICLE_V1, new Map());
    expect(frag.firstElementChild!.hasAttribute("style")).toBe(false);
  });

  it("removes HTML comments", () => {
    const frag = fragmentFromHtml("<p>a<!-- comment --></p>");
    enforceProfile(frag, ARTICLE_V1, new Map());
    expect(serialize(frag)).not.toContain("comment");
  });

  it("removes unregistered custom elements under ui-v1", () => {
    const frag = fragmentFromHtml("<my-widget>x</my-widget>");
    const { removedElements } = enforceProfile(frag, UI_V1, new Map());
    expect(frag.childNodes.length).toBe(0);
    expect(removedElements.some((n) => n.reason === "custom-element-not-registered")).toBe(true);
  });

  it("keeps application-registered custom elements and their allowed attributes only", () => {
    const allowlist = new Map([["my-widget", { tag: "my-widget", attributes: ["role"] }]]);
    const frag = fragmentFromHtml('<my-widget role="button" onclick="evil()">x</my-widget>');
    enforceProfile(frag, UI_V1, allowlist);
    const el = frag.firstElementChild!;
    expect(el.tagName.toLowerCase()).toBe("my-widget");
    expect(el.getAttribute("role")).toBe("button");
    expect(el.hasAttribute("onclick")).toBe(false);
  });

  it("plain-text-v1 has no elements allowed at all", () => {
    expect(Object.keys(PLAIN_TEXT_V1.elements)).toHaveLength(0);
  });
});
