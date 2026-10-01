import { describe, it, expect } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { enforceProfile, parseSrcsetUrls } from "../../src/sanitize/enforce.js";
import { deriveProfile, getProfile } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";

const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

function fragmentFromHtml(html: string): DocumentFragment {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content;
}

const URL_ATTRS = ["src", "href", "srcset", "poster", "action", "formaction", "xlink:href", "background", "ping", "cite", "data"];
// A profile whose custom element lists EVERY URL-valued attribute name.
const customProfile = deriveProfile("ui-v1", {
  name: "url-attr-test-v1",
  version: 1,
  customElements: [{ tag: "my-card", attributes: URL_ATTRS.filter((a) => !["action", "formaction", "xlink:href"].includes(a)) }],
});

describe("URL-valued attributes on custom elements go through checkUrl", () => {
  for (const attr of URL_ATTRS.filter((a) => !["action", "formaction", "xlink:href"].includes(a))) {
    it(`<my-card ${attr}="javascript:..."> loses ${attr}`, () => {
      const frag = fragmentFromHtml(`<my-card ${attr}="javascript:alert(1)">x</my-card>`);
      const { rewrittenUrls } = enforceProfile(frag, customProfile);
      expect(frag.firstElementChild!.hasAttribute(attr)).toBe(false);
      expect(rewrittenUrls).toHaveLength(1);
    });

    it(`<my-card ${attr}="https://ok.example/"> keeps ${attr}`, () => {
      const frag = fragmentFromHtml(`<my-card ${attr}="https://ok.example/a.png">x</my-card>`);
      enforceProfile(frag, customProfile);
      expect(frag.firstElementChild!.hasAttribute(attr)).toBe(true);
    });
  }

  it("even an attribute the profile's own urlAttributes list does not name is checked (data, background, ping)", () => {
    expect(customProfile.urlAttributes).not.toContain("data");
    const frag = fragmentFromHtml(
      '<my-card data="data:text/html,<script>1</script>" ping="https://a.example/ javascript:alert(1)" background="vbscript:x">x</my-card>',
    );
    enforceProfile(frag, customProfile);
    const el = frag.firstElementChild!;
    expect(el.hasAttribute("data")).toBe(false);
    expect(el.hasAttribute("ping")).toBe(false);
    expect(el.hasAttribute("background")).toBe(false);
  });
});

describe("srcset / imagesrcset: every candidate is checked", () => {
  const article = getProfile("article-v1")!;
  const withSrcset = deriveProfile(article, { name: "srcset-test-v1", version: 1, addElements: { img: ["src", "srcset", "alt"], source: ["srcset", "src"] } });

  it("parseSrcsetUrls follows the HTML algorithm (commas inside URLs, descriptors, trailing commas)", () => {
    expect(parseSrcsetUrls("a.png 1x, b.png 2x")).toEqual(["a.png", "b.png"]);
    // no whitespace after the comma: per the spec this is ONE url containing a comma
    expect(parseSrcsetUrls("a.png,b.png 2x")).toEqual(["a.png,b.png"]);
    expect(parseSrcsetUrls("a.png, b.png 2x")).toEqual(["a.png", "b.png"]);
    expect(parseSrcsetUrls("https://x.example/a,b.png 100w,   javascript:alert(1) 200w")).toEqual(["https://x.example/a,b.png", "javascript:alert(1)"]);
    expect(parseSrcsetUrls("  a.png   ,  ")).toEqual(["a.png"]);
    expect(parseSrcsetUrls("a.png 1x (foo, bar), b.png")).toEqual(["a.png", "b.png"]);
    expect(parseSrcsetUrls("")).toEqual([]);
  });

  it("a single bad candidate removes the whole attribute", () => {
    const frag = fragmentFromHtml('<img src="https://ok.example/a.png" srcset="https://ok.example/a.png 1x, javascript:alert(1) 2x" alt="x">');
    const { rewrittenUrls } = enforceProfile(frag, withSrcset);
    const img = frag.firstElementChild!;
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.hasAttribute("src")).toBe(true);
    expect(rewrittenUrls[0]!.attribute).toBe("srcset");
  });

  it("all-good candidates survive", () => {
    const frag = fragmentFromHtml('<img srcset="https://ok.example/a.png 1x, /b.png 2x, c.png 3x" alt="x">');
    enforceProfile(frag, withSrcset);
    expect(frag.firstElementChild!.hasAttribute("srcset")).toBe(true);
  });

  it("obfuscated and http candidates are rejected too", () => {
    for (const bad of ["http://insecure.example/a.png 1x", "data:image/png;base64,AAAA 1x", "//evil.example/x.png 1x"]) {
      const frag = fragmentFromHtml(`<img srcset="https://ok.example/a.png 1x, ${bad}" alt="x">`);
      enforceProfile(frag, withSrcset, { baseUrl: "http://page.example/" });
      expect(frag.firstElementChild!.hasAttribute("srcset"), bad).toBe(false);
    }
  });

  it("the whole value is also checked as one URL, so whitespace inside a scheme cannot split it into harmless candidates", () => {
    // As srcset, "java\tscript:alert(1)" parses into the URL "java" plus a
    // descriptor, but the attribute value read as a single URL (as a custom
    // element might) is javascript: once the URL parser strips the tab.
    for (const bad of ["java\tscript:alert(1)", "java\nscript:alert(1) 1x", "https://ok.example/a.png 1x, java\tscript:alert(1)"]) {
      for (const [tag, attr] of [["img", "srcset"], ["my-card", "srcset"], ["my-card", "ping"]] as const) {
        const frag = document.createDocumentFragment();
        const el = document.createElement(tag);
        el.setAttribute(attr, bad);
        frag.append(el);
        enforceProfile(frag, tag === "img" ? withSrcset : customProfile);
        expect(el.hasAttribute(attr), `${tag} ${attr}=${JSON.stringify(bad)}`).toBe(false);
      }
    }
  });

  it("imagesrcset is checked as well", () => {
    const p = deriveProfile(article, { name: "imagesrcset-test-v1", version: 1, addElements: { img: ["imagesrcset"] } });
    const frag = fragmentFromHtml('<img imagesrcset="javascript:alert(1) 1x">');
    enforceProfile(frag, p);
    expect(frag.firstElementChild!.hasAttribute("imagesrcset")).toBe(false);
  });
});

describe("blockRelativeAutoLoadUrls (same-origin GET side effects)", () => {
  const email = getProfile("email-v1")!;
  const article = getProfile("article-v1")!;

  it("email-v1 removes relative img src, but keeps absolute https and relative links", () => {
    const frag = fragmentFromHtml(
      '<img src="/logout" alt="a"><img src="pixel.gif" alt="b"><img src="https://cdn.example/p.png" alt="c"><a href="/account">acct</a>',
    );
    const { rewrittenUrls } = enforceProfile(frag, email);
    const imgs = [...frag.querySelectorAll("img")];
    expect(imgs.map((i) => i.hasAttribute("src"))).toEqual([false, false, true]);
    expect(frag.querySelector("a")!.getAttribute("href")).toBe("/account");
    expect(rewrittenUrls.map((n) => n.reason)).toEqual(["relative-url-on-auto-load", "relative-url-on-auto-load"]);
  });

  it("article-v1 does not block it (documented risk), and a derived profile can opt in", () => {
    const frag = fragmentFromHtml('<img src="/logout" alt="a">');
    enforceProfile(frag, article);
    expect(frag.querySelector("img")!.getAttribute("src")).toBe("/logout");

    const strict = deriveProfile(article, { name: "article-strict-v1", version: 1, blockRelativeAutoLoadUrls: true });
    const frag2 = fragmentFromHtml('<img src="/logout" alt="a">');
    enforceProfile(frag2, strict);
    expect(frag2.querySelector("img")!.hasAttribute("src")).toBe(false);
  });

  for (const engine of engines) {
    it(`email-v1 end to end (${engine}): the relative src never reaches the output`, async () => {
      const { fragment, report } = await sanitize(document, '<p>hi</p><img src="/logout?x=1" alt="x">', email, { forceEngine: engine });
      const host = document.createElement("div");
      host.appendChild(fragment);
      expect(host.querySelector("img")!.hasAttribute("src")).toBe(false);
      expect(report.rewrittenUrls).toHaveLength(1);
    });
  }
});
