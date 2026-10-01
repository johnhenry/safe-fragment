import { describe, it, expect } from "vitest";
import { enforceProfile } from "../../src/sanitize/enforce.js";
import { rebuildFragment } from "../../src/sanitize/rebuild.js";
import { deriveProfile, registerProfile, unregisterProfile } from "../../src/policy/registry.js";
import { ARTICLE_V1_PROFILE } from "../../src/profiles/article-v1.js";
import {
  isFontFamilyList,
  isFragmentId,
  isPathData,
  isPlainValue,
  isTransformList,
  parseFragmentRef,
  parsePaint,
  SVG_NAMESPACE,
  MATHML_NAMESPACE,
} from "../../src/policy/foreign.js";
import { sanitizeToFragment } from "../../src/sanitize/public.js";
import type { ProfileDefinition } from "../../src/policy/profile.js";

// safe-fragment#3 / ADR 0010: SVG ("static") and MathML ("presentation") are opt-in
// per profile; everything else foreign is still dropped.

const RICH: ProfileDefinition = deriveProfile(ARTICLE_V1_PROFILE, { name: "unit-rich-v1", svg: "static", mathml: "presentation" });
const SVG_ONLY: ProfileDefinition = deriveProfile(ARTICLE_V1_PROFILE, { name: "unit-svg-v1", svg: "static" });
const BASE = "https://app.example/";

function frag(html: string): DocumentFragment {
  const t = document.createElement("template");
  t.innerHTML = html;
  const f = document.createDocumentFragment();
  while (t.content.firstChild) f.appendChild(t.content.firstChild);
  return f;
}
function html(f: DocumentFragment): string {
  const d = document.createElement("div");
  d.appendChild(f.cloneNode(true));
  return d.innerHTML;
}
function run(input: string, profile: ProfileDefinition = RICH, idPolicy?: "keep-in-shadow") {
  const f = frag(input);
  const notes = enforceProfile(f, profile, { baseUrl: BASE, idPolicy });
  return { f, notes, out: html(f) };
}

describe("profile options svg / mathml", () => {
  it("are validated, derivable and removable", () => {
    expect(RICH.svg).toBe("static");
    expect(RICH.mathml).toBe("presentation");
    expect(deriveProfile(RICH, { name: "unit-nomath-v1", mathml: null }).mathml).toBeUndefined();
    expect(deriveProfile(RICH, { name: "unit-keep-v1" }).svg).toBe("static");
    expect(() => registerProfile({ ...RICH, name: "unit-bad-v1", svg: "animated" as unknown as "static" })).toThrow(/svg/);
    expect(() => registerProfile({ ...RICH, name: "unit-bad2-v1", mathml: "content" as unknown as "presentation" })).toThrow(/mathml/);
    const ok = registerProfile(RICH);
    expect(ok.svg).toBe("static");
    expect(Object.isFrozen(ok)).toBe(true);
    unregisterProfile("unit-rich-v1");
  });

  it("built-in profiles do not opt in", () => {
    expect(ARTICLE_V1_PROFILE.svg).toBeUndefined();
    expect(ARTICLE_V1_PROFILE.mathml).toBeUndefined();
  });
});

describe("without the opt-in", () => {
  it("every SVG and MathML element is dropped with its subtree (ADR 0004)", () => {
    const { out, notes } = run('<p>a</p><svg><rect width="1" height="1"></rect></svg><math><mi>x</mi></math><p>b</p>', ARTICLE_V1_PROFILE);
    expect(out).toBe("<p>a</p><p>b</p>");
    expect(notes.removedElements.filter((n) => n.reason === "element-dropped:foreign-namespace").map((n) => n.tag)).toEqual(["svg", "math"]);
  });

  it("math is dropped when only svg is opted in, and svg when only mathml is", () => {
    expect(run("<svg><rect></rect></svg><math><mi>x</mi></math>", SVG_ONLY).out).toBe("<svg><rect></rect></svg>");
    const mathOnly = deriveProfile(ARTICLE_V1_PROFILE, { name: "unit-math-v1", mathml: "presentation" });
    expect(run("<svg><rect></rect></svg><math><mi>x</mi></math>", mathOnly).out).toBe("<math><mi>x</mi></math>");
  });
});

describe("SVG static", () => {
  it("keeps the allowlisted shapes with namespace-correct elements after the rebuild", () => {
    const { f } = run('<svg viewBox="0 0 10 10"><g><path d="M0 0L1 1"></path></g></svg>');
    const out = rebuildFragment(f);
    const svg = out.querySelector("svg")!;
    expect(svg.namespaceURI).toBe(SVG_NAMESPACE);
    expect(svg.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(svg.querySelector("path")!.namespaceURI).toBe(SVG_NAMESPACE);
    expect(svg.querySelector("path")!.localName).toBe("path");
  });

  it("removes event handlers, style, and attributes that are not listed", () => {
    const { out, notes } = run(
      '<svg onload="x()" style="a:b" data-x="1" xmlns="http://www.w3.org/2000/svg" width="5"><circle r="1" onclick="x()" foo="bar"></circle></svg>',
    );
    expect(out).toBe('<svg width="5"><circle r="1"></circle></svg>');
    expect(notes.removedAttributes.map((n) => n.reason).sort()).toEqual(
      [
        "attribute-not-in-profile",
        "attribute-not-in-profile",
        "attribute-not-in-profile",
        "forbidden-attribute-class",
        "forbidden-attribute-class",
        "style-attribute-disallowed",
      ].sort(),
    );
  });

  it("drops script, style, foreignObject, animation, and names the engines allow as HTML (a, caption, figure) with their subtree; unwraps switch, filter, mask", () => {
    const { out } = run(
      "<svg><script>1</script><style>2</style><foreignObject><p>3</p></foreignObject><animate></animate><set></set><a><circle r='1'></circle></a><caption>c</caption><switch><rect></rect></switch><filter><circle r='2'></circle></filter><mask><path d='M0 0'></path></mask></svg>",
    );
    expect(out).toBe('<svg><rect></rect><circle r="2"></circle><path d="M0 0"></path></svg>');
  });

  describe("use, href and xlink:href", () => {
    it("keeps a same-fragment #id, namespaced like every id, for href and xlink:href", () => {
      const { f, out } = run('<svg><defs><symbol id="s"></symbol></defs><use href="#s"></use><use xlink:href="#s"></use></svg>');
      expect(out).toContain('id="user-content-s"');
      const uses = [...f.querySelectorAll("use")];
      expect(uses[0]!.getAttribute("href")).toBe("#user-content-s");
      // the legacy attribute stays an XLink-namespace attribute (no duplicate null-namespace "xlink:href")
      expect(uses[1]!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe("#user-content-s");
      expect(uses[1]!.attributes.length).toBe(1);
    });

    it("keep-in-shadow leaves ids as written", () => {
      const { out } = run('<svg><symbol id="s"></symbol><use href="#s"></use></svg>', RICH, "keep-in-shadow");
      expect(out).toContain('id="s"');
      expect(out).toContain('href="#s"');
    });

    for (const bad of [
      "https://evil.example/x.svg#a",
      "//evil.example/x.svg#a",
      "javascript:alert(1)",
      "data:image/svg+xml;base64,AAAA",
      "x.svg#a",
      "/x.svg#a",
      "#",
      "#a b",
      "#a:b",
      "",
      "blob:https://x/y",
      "cid:x",
    ]) {
      it(`removes use href=${JSON.stringify(bad)}`, () => {
        const f = frag("<svg><use></use></svg>");
        const use = f.querySelector("use")!;
        use.setAttribute("href", bad);
        enforceProfile(f, RICH, { baseUrl: BASE });
        expect(use.hasAttribute("href"), bad).toBe(false);
      });
    }

    it("runs every URL attribute through checkUrl: a profile without relative URLs refuses even #id", () => {
      const strict = deriveProfile(RICH, { name: "unit-strict-v1", urlSchemes: ["https:"] });
      const { out } = run('<svg><use href="#s"></use></svg>', strict);
      expect(out).toBe("<svg><use></use></svg>");
    });

    it("removes a null-namespace attribute literally named xlink:href", () => {
      const f = frag("<svg><use></use></svg>");
      f.querySelector("use")!.setAttribute("xlink:href", "javascript:alert(1)");
      enforceProfile(f, RICH, { baseUrl: BASE });
      expect(f.querySelector("use")!.attributes.length).toBe(0);
    });

    it("removes other XLink and xml: attributes", () => {
      const { out } = run('<svg xml:space="preserve" xlink:title="t" xlink:show="new"><use xlink:actuate="onLoad"></use></svg>');
      expect(out).toBe("<svg><use></use></svg>");
    });
  });

  describe("paint, path and transform values", () => {
    const keep: Array<[string, string]> = [
      ["fill", "none"],
      ["fill", "#fff"],
      ["fill", "currentColor"],
      ["fill", "rgb(1 2 3)"],
      ["fill", "rgba(1, 2, 3, 0.5)"],
      ["fill", "hsl(10 50% 50%)"],
      ["stroke", "red"],
      ["stroke-width", "1.5"],
      ["opacity", "0.5"],
      ["d", "M0 0 L10,10 C1 2 3 4 5 6 Z"],
      ["d", "m-1.5e-2 3l4 5z"],
      ["transform", "translate(1 2) rotate(45) scale(2)"],
      ["transform", "matrix(1,0,0,1,0,0)"],
    ];
    for (const [attr, value] of keep) {
      it(`keeps ${attr}=${JSON.stringify(value)}`, () => {
        const f = frag("<svg><path></path></svg>");
        f.querySelector("path")!.setAttribute(attr, value);
        enforceProfile(f, RICH, { baseUrl: BASE });
        expect(f.querySelector("path")!.getAttribute(attr)).toBe(value);
      });
    }
    const drop: Array<[string, string]> = [
      ["fill", "url(https://evil.example/x.svg#a)"],
      ["fill", "url(//evil.example/#a)"],
      ["fill", 'url("javascript:alert(1)")'],
      ["fill", "url('#a')"],
      ["fill", "url(#a b)"],
      ["fill", "u\\72l(#a)"],
      ["fill", "url(#a) javascript:alert(1)"],
      ["fill", "red;background:url(x)"],
      ["fill", "red /* c */"],
      ["fill", "var(--x)"],
      ["fill", "expression(alert(1))"],
      ["fill", "image-set(url(x) 1x)"],
      ["fill", "rgb(1,2,javascript:3)"],
      ["clip-path", "url(javascript:alert(1))"],
      ["clip-path", "circle(50%)"],
      ["clip-path", "url(#a) url(#b)"],
      ["d", "M0 0 javascript:alert(1)"],
      ["d", "M0 0 L1 1 onload=x"],
      ["transform", "translate(1) evil(2)"],
      ["transform", "url(javascript:alert(1))"],
      ["transform", "translate(1"],
      ["stroke-width", "1px;2"],
      ["stroke-width", "1/2"],
      ["display", "none;x"],
    ];
    for (const [attr, value] of drop) {
      it(`drops ${attr}=${JSON.stringify(value)}`, () => {
        const f = frag("<svg><path></path></svg>");
        f.querySelector("path")!.setAttribute(attr, value);
        enforceProfile(f, RICH, { baseUrl: BASE });
        expect(f.querySelector("path")!.hasAttribute(attr), value).toBe(false);
      });
    }

    it("rewrites a local url(#id) reference to the namespaced id, keeping a plain fallback", () => {
      const { out } = run('<svg><defs><linearGradient id="g"></linearGradient></defs><rect fill="url(#g) red" clip-path="url(#g)"></rect></svg>');
      expect(out).toContain('fill="url(#user-content-g) red"');
      expect(out).toContain('clip-path="url(#user-content-g)"');
      expect(out).toContain('id="user-content-g"');
    });
  });

  describe("placement and integration points", () => {
    it("keeps a nested svg, drops math inside svg, svg inside math", () => {
      expect(run('<svg><svg width="1"><rect></rect></svg></svg>').out).toBe('<svg><svg width="1"><rect></rect></svg></svg>');
      expect(run("<svg><text><math><mi>x</mi></math></text></svg>").out).toBe("<svg><text></text></svg>");
      expect(run("<math><mrow><svg><rect></rect></svg></mrow></math>").out).toBe("<math><mrow></mrow></math>");
    });

    it("title and desc hold text only: allowed descendants go with their content, unknown ones are unwrapped, raw-text containers dropped (as DOMPurify does)", () => {
      expect(run("<svg><title>T<b>x<i>z</i></b></title><desc><p>y</p>D<script>1</script><unknown-el>u</unknown-el><foo>f<b>g</b></foo></desc></svg>").out).toBe(
        "<svg><title>T</title><desc>Duf</desc></svg>",
      );
    });

    it("an HTML element parented to an SVG element is dropped (a parser or engine quirk can never leave one)", () => {
      const f = frag("<svg><g></g></svg>");
      const p = document.createElement("p");
      p.textContent = "x";
      f.querySelector("g")!.appendChild(p);
      enforceProfile(f, RICH, { baseUrl: BASE });
      expect(f.querySelector("p")).toBeNull();
    });

    it("an SVG element outside <svg> (a DOM-built tree) is dropped", () => {
      const f = document.createDocumentFragment();
      const rect = document.createElementNS(SVG_NAMESPACE, "rect");
      const host = document.createElement("div");
      host.appendChild(rect);
      f.appendChild(host);
      enforceProfile(f, RICH, { baseUrl: BASE });
      expect(host.querySelector("rect")).toBeNull();
    });
  });

  it("class tokens go through allowedClasses like HTML", () => {
    const withClasses = deriveProfile(RICH, { name: "unit-svgclass-v1", allowedClasses: ["ok-*"] });
    const { out } = run('<svg class="ok-a bad"><rect class="bad"></rect></svg>', withClasses);
    expect(out).toBe('<svg class="ok-a"><rect></rect></svg>');
  });

  it("aria-labelledby ids are namespaced, invalid ones dropped", () => {
    const { out } = run('<svg aria-labelledby="t d"><title id="t">a</title><desc id="d">b</desc></svg>');
    expect(out).toContain('aria-labelledby="user-content-t user-content-d"');
    expect(run('<svg aria-labelledby="a:b"></svg>').out).toBe("<svg></svg>");
  });

  it("an attribute value that closes a raw-text element is removed, as in HTML", () => {
    expect(run('<svg><text class="</style>x" id="a-->b">t</text></svg>').out).toBe("<svg><text>t</text></svg>");
  });
});

describe("MathML presentation", () => {
  it("keeps presentation elements and their attributes", () => {
    const { out } = run('<math display="block"><mfrac linethickness="2px"><mi mathvariant="bold">a</mi><mn>2</mn></mfrac></math>');
    expect(out).toBe('<math display="block"><mfrac linethickness="2px"><mi mathvariant="bold">a</mi><mn>2</mn></mfrac></math>');
    expect(frag("<math><mi>x</mi></math>").querySelector("math")!.namespaceURI).toBe(MATHML_NAMESPACE);
  });

  it("drops annotation, annotation-xml with their content; unwraps semantics, maction, mglyph", () => {
    const { out } = run(
      '<math><semantics><mrow><mi>x</mi></mrow><annotation encoding="x">TEX</annotation><annotation-xml encoding="text/html"><p>h</p></annotation-xml></semantics><maction><mi>y</mi></maction><mglyph></mglyph></math>',
    );
    expect(out).toBe("<math><mrow><mi>x</mi></mrow><mi>y</mi></math>");
  });

  it("removes href, xlink:href and style everywhere in MathML", () => {
    const { out } = run('<math href="javascript:1" style="a:b"><mi href="javascript:2" xlink:href="javascript:3">x</mi></math>');
    expect(out).toBe("<math><mi>x</mi></math>");
  });

  it("text integration points hold text only", () => {
    expect(run("<math><mtext>a<mglyph></mglyph><b>x</b></mtext><mi>i<svg><rect></rect></svg></mi></math>").out).toBe("<math><mtext>a</mtext><mi>i</mi></math>");
  });
});

describe("validators", () => {
  it("are character scans over small grammars", () => {
    expect(isPlainValue("1.5, 2 %#a_b-+")).toBe(true);
    expect(isPlainValue("a;b")).toBe(false);
    expect(isPlainValue("a(b)")).toBe(false);
    expect(isPlainValue("a/b")).toBe(false);
    expect(isPlainValue("a\\b")).toBe(false);
    expect(isPathData("M0 0h5V5Z")).toBe(true);
    expect(isPathData("M0 0 X")).toBe(false);
    expect(isTransformList("")).toBe(true);
    expect(isTransformList("rotate(45 1 1),scale(2)")).toBe(true);
    expect(isTransformList("rotate(a)")).toBe(false);
    expect(isFragmentId("a.b_c-d")).toBe(true);
    expect(isFragmentId("a b")).toBe(false);
    expect(parseFragmentRef(" #abc ")).toBe("abc");
    expect(parseFragmentRef("abc")).toBeUndefined();
    expect(parsePaint("url(#a)  red")).toEqual({ ok: true, refId: "a", fallback: "red" });
    expect(parsePaint("URL( #a )")).toEqual({ ok: true, refId: "a", fallback: undefined });
    expect(parsePaint("none", false)).toEqual({ ok: true });
    expect(parsePaint("red", false)).toEqual({ ok: false });
    expect(isFontFamilyList("Arial, Helvetica Neue, sans-serif")).toBe(true);
    expect(isFontFamilyList('"Arial"')).toBe(false);
  });
});

describe("through sanitizeToFragment", () => {
  it("an opted-in profile renders an SVG whose elements are real SVG elements in the live document", async () => {
    registerProfile(RICH);
    try {
      const { fragment } = await sanitizeToFragment('<svg viewBox="0 0 4 4" width="40"><circle cx="2" cy="2" r="1" fill="red"></circle></svg>', {
        profile: "unit-rich-v1",
      });
      const host = document.createElement("div");
      host.appendChild(fragment);
      document.body.appendChild(host);
      try {
        const circle = host.querySelector("circle")!;
        expect(circle.namespaceURI).toBe(SVG_NAMESPACE);
        expect(circle.getAttribute("fill")).toBe("red");
        expect(host.querySelector("svg")!.getBoundingClientRect().width).toBe(40);
      } finally {
        host.remove();
      }
    } finally {
      unregisterProfile("unit-rich-v1");
    }
  });
});
