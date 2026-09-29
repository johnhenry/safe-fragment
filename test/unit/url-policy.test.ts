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
});
