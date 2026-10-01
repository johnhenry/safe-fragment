import { describe, it, expect } from "vitest";
import { checkUrl, SAFE_DEFAULT_URL_SCHEMES } from "../../src/policy/url.js";

describe("checkUrl", () => {
  it("allows relative URLs when relative is allowed", () => {
    expect(checkUrl("/path/to/page", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(true);
    expect(checkUrl("page.html", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(true);
    expect(checkUrl("#fragment", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(true);
    expect(checkUrl("?query=1", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(true);
    expect(checkUrl("", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(true);
  });

  it("allows https: URLs", () => {
    expect(checkUrl("https://example.com/x", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(true);
  });

  it("allows mailto: URLs", () => {
    expect(checkUrl("mailto:person@example.com", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(true);
  });

  it("rejects http: when not in the allowlist", () => {
    const result = checkUrl("http://example.com/x", SAFE_DEFAULT_URL_SCHEMES);
    expect(result.allowed).toBe(false);
    expect(result.scheme).toBe("http:");
  });

  it("rejects javascript: URLs", () => {
    expect(checkUrl("javascript:alert(1)", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(false);
  });

  it("rejects javascript: URLs with leading/trailing whitespace", () => {
    expect(checkUrl("   javascript:alert(1)  ", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(false);
  });

  it("rejects javascript: URLs with an embedded tab in the scheme", () => {
    expect(checkUrl("java\tscript:alert(1)", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(false);
  });

  it("rejects javascript: URLs with mixed case", () => {
    expect(checkUrl("JaVaScRiPt:alert(1)", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(checkUrl("data:text/html,<script>alert(1)</script>", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(false);
  });

  it("rejects vbscript: URLs", () => {
    expect(checkUrl("vbscript:msgbox(1)", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(false);
  });

  it("rejects file: URLs", () => {
    expect(checkUrl("file:///etc/passwd", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(false);
  });

  it("treats protocol-relative URLs as inheriting the probe scheme (https)", () => {
    // //evil.example/x resolves to https://evil.example/x against an https
    // base -- gated by whether https: is allowed, not auto-treated as "relative".
    const result = checkUrl("//evil.example/x", SAFE_DEFAULT_URL_SCHEMES);
    expect(result.scheme).toBe("https:");
    expect(result.allowed).toBe(true); // https: is allowed by SAFE_DEFAULT_URL_SCHEMES
  });

  it("rejects protocol-relative URLs when https is not allowed", () => {
    const result = checkUrl("//evil.example/x", ["relative"]);
    expect(result.allowed).toBe(false);
  });

  it("fails closed when the allowlist is empty", () => {
    expect(checkUrl("/relative/path", []).allowed).toBe(false);
    expect(checkUrl("https://example.com/", []).allowed).toBe(false);
  });

  describe("authority-bearing relative URLs resolve against the real document base", () => {
    const HTTPS_ONLY = ["https:"];
    const REL_AND_HTTPS = ["relative", "https:"];
    const variants = ["//evil.example/x", "\\\\evil.example/x", "/\\evil.example/x", "\\/evil.example/x", "  //evil.example/x", "\t//evil.example/x"];

    it.each(variants)("%j on an http page is http:, rejected by an https-only profile", (value) => {
      const r = checkUrl(value, REL_AND_HTTPS, "http://page.example/doc");
      expect(r.scheme).toBe("http:");
      expect(r.allowed).toBe(false);
    });

    it.each(variants)("%j on an https page is https:", (value) => {
      const r = checkUrl(value, HTTPS_ONLY, "https://page.example/doc");
      expect(r.scheme).toBe("https:");
      expect(r.allowed).toBe(true);
    });

    it.each(variants)("%j is never classified relative", (value) => {
      expect(checkUrl(value, ["relative"], "https://page.example/").allowed).toBe(false);
      expect(checkUrl(value, ["relative"]).allowed).toBe(false);
    });

    it("fails closed when the base cannot resolve authority-bearing references (about:blank, data:)", () => {
      expect(checkUrl("//evil.example/x", REL_AND_HTTPS, "about:blank")).toEqual({ allowed: false, scheme: "unparseable" });
      expect(checkUrl("//evil.example/x", REL_AND_HTTPS, "not a url")).toEqual({ allowed: false, scheme: "unparseable" });
    });

    it("plain relative references stay relative whatever the base", () => {
      expect(checkUrl("/a/b", ["relative"], "http://page.example/").allowed).toBe(true);
      expect(checkUrl("a/b", ["relative"], "about:blank").allowed).toBe(true);
    });

    it("the real document's base (http test page) rejects // under the https-only allowlist", () => {
      expect(location.protocol).toBe("http:");
      expect(checkUrl("//evil.example/x", HTTPS_ONLY, document.baseURI).allowed).toBe(false);
    });
  });
});

describe("checkUrl: invisible and ignorable characters inside a scheme (fuzzer finding F6)", () => {
  // Browsers reject `java<U+FEFF>script:` as a scheme (it parses as a relative path), but code that reads the
  // attribute with its own normalization (a custom element, a framework, an old engine) may strip format
  // characters first. The check already squeezed C0 controls, spaces and U+2000-U+2029 (DOMPurify's list); the
  // fuzzer's independent oracle also treats the other Unicode default-ignorable characters as invisible.
  const ignorable: Array<[string, string]> = [
    ["U+FEFF (BOM / zero width no-break space)", "\ufeff"],
    ["U+2060 (word joiner)", "\u2060"],
    ["U+00AD (soft hyphen)", "\u00ad"],
    ["U+200B (zero width space)", "\u200b"],
    ["U+180E (Mongolian vowel separator)", "\u180e"],
    ["U+034F (combining grapheme joiner)", "\u034f"],
    ["U+061C (Arabic letter mark)", "\u061c"],
    ["U+202E (right-to-left override)", "\u202e"],
    ["U+206F (nominal digit shapes)", "\u206f"],
    ["U+FE0F (variation selector-16)", "\ufe0f"],
    ["U+3164 (Hangul filler)", "\u3164"],
    ["U+FFA0 (halfwidth Hangul filler)", "\uffa0"],
  ];
  for (const [name, ch] of ignorable) {
    it(`rejects java${name}script:`, () => {
      expect(checkUrl(`java${ch}script:alert(1)`, SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(false);
      expect(checkUrl(`${ch}javascript:alert(1)`, SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(false);
      expect(checkUrl(`vb${ch}script:x`, SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(false);
    });
  }

  it("still allows an ordinary relative URL that merely contains such a character", () => {
    expect(checkUrl("docs/caf\u00e9\u200b/page.html", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(true);
    expect(checkUrl("a\ufeffb", SAFE_DEFAULT_URL_SCHEMES).allowed).toBe(true);
  });
});
