import { describe, it, expect } from "vitest";
import { enforceProfile } from "../../src/sanitize/enforce.js";
import { deriveProfile } from "../../src/policy/registry.js";
import { ARTICLE_V1_PROFILE } from "../../src/profiles/article-v1.js";
import { UI_V1_PROFILE } from "../../src/profiles/ui-v1.js";
import { PLAIN_TEXT_V1_PROFILE } from "../../src/profiles/plain-text-v1.js";

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
    const { removedElements } = enforceProfile(frag, ARTICLE_V1_PROFILE);
    expect(serialize(frag)).toBe("<p>keep</p>");
    expect(removedElements.some((n) => n.tag === "script")).toBe(true);
  });

  it("removes attributes not allowlisted for the element", () => {
    const frag = fragmentFromHtml('<p data-foo="bar" onclick="evil()">x</p>');
    enforceProfile(frag, ARTICLE_V1_PROFILE);
    const p = frag.firstElementChild!;
    expect(p.hasAttribute("data-foo")).toBe(false); // article-v1 does not allow data-*
    expect(p.hasAttribute("onclick")).toBe(false);
  });

  it("keeps data-* attributes when the profile allows them (ui-v1)", () => {
    const frag = fragmentFromHtml('<div data-action="go">x</div>');
    enforceProfile(frag, UI_V1_PROFILE);
    const div = frag.firstElementChild!;
    expect(div.getAttribute("data-action")).toBe("go");
  });

  describe("ui-v1 data-* allowlist and button type", () => {
    it("keeps only data-action; every other data-* (incl. framework handlers) is removed", () => {
      const frag = fragmentFromHtml(
        '<div data-action="go" data-foo="1" data-hx-on:click="evil()" data-hx-on--click="evil()" data-turbo-method="post" data-bs-toggle="x">x</div>',
      );
      const { removedAttributes } = enforceProfile(frag, UI_V1_PROFILE);
      const div = frag.firstElementChild!;
      expect([...div.attributes].map((a) => a.name)).toEqual(["data-action"]);
      expect(removedAttributes.every((n) => n.reason === "data-attribute-not-allowlisted")).toBe(true);
      expect(removedAttributes).toHaveLength(5);
    });

    it("article-v1 allows no data-* at all, not even data-action", () => {
      const frag = fragmentFromHtml('<p data-action="go">x</p>');
      enforceProfile(frag, ARTICLE_V1_PROFILE);
      expect(frag.firstElementChild!.hasAttribute("data-action")).toBe(false);
    });

    it("a profile-level allowedDataAttributes entry is honored exactly (no prefix matching)", () => {
      const custom = { ...UI_V1_PROFILE, allowedDataAttributes: ["data-action", "data-id"] };
      const frag = fragmentFromHtml('<div data-id="1" data-identity="2">x</div>');
      enforceProfile(frag, custom);
      const div = frag.firstElementChild!;
      expect(div.hasAttribute("data-id")).toBe(true);
      expect(div.hasAttribute("data-identity")).toBe(false);
    });

    it.each([
      "<button>x</button>",
      '<button type="submit">x</button>',
      '<button type="reset">x</button>',
      '<button type="SUBMIT">x</button>',
      '<button type="button">x</button>',
    ])("forces type=button on %s", (html) => {
      const frag = fragmentFromHtml(html);
      enforceProfile(frag, UI_V1_PROFILE);
      expect(frag.firstElementChild!.getAttribute("type")).toBe("button");
    });
  });

  it("always strips on* attributes even on allowed elements, regardless of profile config", () => {
    const frag = fragmentFromHtml('<div onclick="evil()" onmouseover="evil()">x</div>');
    enforceProfile(frag, UI_V1_PROFILE);
    const div = frag.firstElementChild!;
    expect(div.hasAttribute("onclick")).toBe(false);
    expect(div.hasAttribute("onmouseover")).toBe(false);
  });

  it("strips disallowed URL schemes from href", () => {
    const frag = fragmentFromHtml('<a href="javascript:evil()">x</a>');
    const { rewrittenUrls } = enforceProfile(frag, ARTICLE_V1_PROFILE);
    const a = frag.firstElementChild!;
    expect(a.hasAttribute("href")).toBe(false);
    expect(rewrittenUrls.length).toBe(1);
  });

  it("keeps allowed URL schemes", () => {
    const frag = fragmentFromHtml('<a href="https://example.com/">x</a>');
    enforceProfile(frag, ARTICLE_V1_PROFILE);
    const a = frag.firstElementChild!;
    expect(a.getAttribute("href")).toBe("https://example.com/");
  });

  it("forces rel=noopener noreferrer on target=_blank anchors", () => {
    const frag = fragmentFromHtml('<a href="https://example.com/" target="_blank" rel="evil">x</a>');
    enforceProfile(frag, ARTICLE_V1_PROFILE);
    const a = frag.firstElementChild!;
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  describe("anchor target hardening (reverse tabnabbing)", () => {
    function anchor(html: string, profile = ARTICLE_V1_PROFILE): Element {
      const frag = fragmentFromHtml(html);
      enforceProfile(frag, profile);
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
      const a = anchor('<a href="https://x.example/" target="_blank" rel="opener noreferrer">x</a>', UI_V1_PROFILE);
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    });
  });

  it("an http page's protocol-relative href is judged as http: (not https:) and removed under the https-only default profile", () => {
    const frag = fragmentFromHtml('<a href="//evil.example/x">a</a><img src="\\\\evil.example/y">');
    const result = enforceProfile(frag, ARTICLE_V1_PROFILE, { baseUrl: "http://page.example/" });
    expect(frag.querySelector("a")!.hasAttribute("href")).toBe(false);
    expect(frag.querySelector("img")!.hasAttribute("src")).toBe(false);
    expect(result.rewrittenUrls.map((n) => n.reason)).toEqual(["disallowed-url-scheme:http:", "disallowed-url-scheme:http:"]);
  });

  it("strips the style attribute unconditionally (no v1 profile allows it)", () => {
    const frag = fragmentFromHtml('<p style="color:red">x</p>');
    enforceProfile(frag, ARTICLE_V1_PROFILE);
    expect(frag.firstElementChild!.hasAttribute("style")).toBe(false);
  });

  it("removes HTML comments", () => {
    const frag = fragmentFromHtml("<p>a<!-- comment --></p>");
    enforceProfile(frag, ARTICLE_V1_PROFILE);
    expect(serialize(frag)).not.toContain("comment");
  });

  it("unwraps unregistered custom elements under ui-v1, keeping their text", () => {
    const frag = fragmentFromHtml("<my-widget>x</my-widget>");
    const { removedElements } = enforceProfile(frag, UI_V1_PROFILE);
    expect(serialize(frag)).toBe("x");
    expect(removedElements.some((n) => n.reason === "element-unwrapped:custom-element-not-registered")).toBe(true);
  });

  describe("disallowed elements: one behavior (ADR 0004)", () => {
    it("unwraps ordinary disallowed elements, keeping text and allowed descendants", () => {
      const frag = fragmentFromHtml("<p>a <marquee>b <em>c</em></marquee> d</p>");
      const { removedElements } = enforceProfile(frag, ARTICLE_V1_PROFILE);
      expect(serialize(frag)).toBe("<p>a b <em>c</em> d</p>");
      expect(removedElements).toEqual([{ tag: "marquee", reason: "element-unwrapped:not-in-profile" }]);
    });

    it("unwraps nested disallowed elements all the way down, still enforcing every descendant", () => {
      const frag = fragmentFromHtml('<blink><font>x<a href="javascript:evil()" onclick="evil()">y</a></font></blink>');
      enforceProfile(frag, ARTICLE_V1_PROFILE);
      expect(serialize(frag)).toBe("x<a>y</a>");
    });

    it.each(["script", "style", "template", "noscript", "iframe", "noembed", "noframes", "xmp", "textarea", "title", "select", "object", "embed"])(
      "drops <%s> with its whole subtree",
      (tag) => {
        const t = document.createElement("template");
        const el = document.createElement(tag);
        el.appendChild(document.createTextNode("PAYLOAD"));
        t.content.append(document.createTextNode("keep"), el);
        const { removedElements } = enforceProfile(t.content, ARTICLE_V1_PROFILE);
        expect(serialize(t.content)).toBe("keep");
        expect(removedElements.some((n) => n.tag === tag && n.reason === "element-dropped:dangerous-container")).toBe(true);
      },
    );

    it("drops svg/math subtrees, and any foreign-namespace element regardless of tag name", () => {
      const t = document.createElement("template");
      const svgA = document.createElementNS("http://www.w3.org/2000/svg", "a");
      svgA.setAttribute("href", "https://ok.example/");
      svgA.textContent = "svg link text";
      t.content.append(document.createTextNode("keep"), svgA);
      const { removedElements } = enforceProfile(t.content, ARTICLE_V1_PROFILE);
      expect(serialize(t.content)).toBe("keep");
      expect(removedElements[0]!.reason).toBe("element-dropped:foreign-namespace");

      const frag = fragmentFromHtml("<p>x</p><svg><text>t</text></svg><math><mi>m</mi></math>");
      enforceProfile(frag, ARTICLE_V1_PROFILE);
      expect(serialize(frag)).toBe("<p>x</p>");
    });

    it("table cells are unwrapped in a profile without tables", () => {
      const frag = fragmentFromHtml("<table><tbody><tr><td>one</td><td>two</td></tr></tbody></table>");
      enforceProfile(frag, UI_V1_PROFILE);
      expect(serialize(frag)).toBe("onetwo");
    });
  });

  it("keeps application-registered custom elements and their allowed attributes only", () => {
    const profile = deriveProfile(UI_V1_PROFILE, { name: "enforce-test-ui", customElements: [{ tag: "my-widget", attributes: ["role"] }] });
    const frag = fragmentFromHtml('<my-widget role="button" onclick="evil()">x</my-widget>');
    enforceProfile(frag, profile);
    const el = frag.firstElementChild!;
    expect(el.tagName.toLowerCase()).toBe("my-widget");
    expect(el.getAttribute("role")).toBe("button");
    expect(el.hasAttribute("onclick")).toBe(false);
  });

  it("plain-text-v1 has no elements allowed at all", () => {
    expect(Object.keys(PLAIN_TEXT_V1_PROFILE.elements)).toHaveLength(0);
  });
});

describe("enforceProfile: cross-engine value parity (X6)", () => {
  it("trims attribute values the way DOMPurify does", () => {
    const frag = fragmentFromHtml('<p title="  padded  " lang=" en ">x</p><a href=" ">y</a>');
    enforceProfile(frag, ARTICLE_V1_PROFILE);
    expect(serialize(frag)).toBe('<p title="padded" lang="en">x</p><a href="">y</a>');
  });

  for (const href of [
    "java script:alert(1)",
    "javascript&#8203;:alert(1)",
    "java\u00a0script:alert(1)",
    "\u2003javascript:alert(1)",
    "jav\u2028ascript:alert(1)",
  ]) {
    it(`removes an href that is javascript: once invisible characters are stripped: ${JSON.stringify(href)}`, () => {
      const a = document.createElement("a");
      a.setAttribute("href", href.replace("&#8203;", "\u200b"));
      const frag = document.createDocumentFragment();
      frag.appendChild(a);
      enforceProfile(frag, ARTICLE_V1_PROFILE);
      expect(frag.firstElementChild!.hasAttribute("href")).toBe(false);
    });
  }

  it("still keeps ordinary relative URLs that contain spaces", () => {
    const a = document.createElement("a");
    a.setAttribute("href", "my file.html");
    const frag = document.createDocumentFragment();
    frag.appendChild(a);
    enforceProfile(frag, ARTICLE_V1_PROFILE);
    expect(frag.firstElementChild!.getAttribute("href")).toBe("my file.html");
  });

  describe("clobberable `name` values (a derived profile may allow `name`; DOMPurify's SANITIZE_DOM is off)", () => {
    const named = deriveProfile("ui-v1", {
      name: "named-v1",
      addElements: { img: ["name", "src"], slot: ["name"], "x-c": ["name"] },
      customElements: [{ tag: "x-c", attributes: ["name"] }],
    });

    it("namespaces `name` on elements that create named properties, under every idPolicy", () => {
      for (const idPolicy of [undefined, "keep-in-shadow"] as const) {
        const frag = fragmentFromHtml('<img name="cookie" src="a.png"><form name="x"></form>');
        enforceProfile(frag, named, { idPolicy });
        expect(serialize(frag)).toContain('<img name="user-content-cookie"');
      }
    });

    it("keeps `name` verbatim on <slot> and custom elements", () => {
      const frag = fragmentFromHtml('<slot name="title"></slot><x-c name="location"></x-c>');
      enforceProfile(frag, named);
      expect(serialize(frag)).toBe('<slot name="title"></slot><x-c name="location"></x-c>');
    });
  });

  it('idPolicy "keep-in-shadow" leaves ids and references alone; the default prefixes them', () => {
    const input = '<label for="a" id="l">x</label><button id="a" aria-labelledby="l">b</button><a href="#a">j</a>';
    const kept = fragmentFromHtml(input);
    enforceProfile(kept, UI_V1_PROFILE, { idPolicy: "keep-in-shadow" });
    expect(serialize(kept)).toContain('id="a"');
    expect(serialize(kept)).toContain('href="#a"');
    expect(serialize(kept)).not.toContain("user-content-");
    const prefixed = fragmentFromHtml(input);
    enforceProfile(prefixed, UI_V1_PROFILE);
    expect(serialize(prefixed)).toContain('id="user-content-a"');
    expect(serialize(prefixed)).toContain('href="#user-content-a"');
  });
});
