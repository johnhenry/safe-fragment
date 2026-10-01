import { describe, it, expect } from "vitest";
import { enforceProfile } from "../../src/sanitize/enforce.js";
import { deriveProfile, registerProfile, unregisterProfile } from "../../src/policy/registry.js";
import { EMAIL_V1_PROFILE } from "../../src/profiles/email-v1.js";
import { ARTICLE_V1_PROFILE } from "../../src/profiles/article-v1.js";
import { sanitizeToFragment } from "../../src/sanitize/public.js";

// safe-fragment#2 / ADR 0009: email-v1 for real. `cid:` is an allowlisted scheme the
// library never fetches: it is handed to a caller-supplied resolver and replaced by
// whatever safe URL that returns; MSO conditional comments and VML are removed; the
// table-layout attributes real mail uses survive, `style` still does not.

function frag(html: string): DocumentFragment {
  const t = document.createElement("template");
  t.innerHTML = html;
  const f = document.createDocumentFragment();
  while (t.content.firstChild) f.appendChild(t.content.firstChild);
  return f;
}
function serialize(f: DocumentFragment): string {
  const d = document.createElement("div");
  d.appendChild(f.cloneNode(true));
  return d.innerHTML;
}
const BASE = "https://app.example/";

describe("email-v1: cid: images through a caller-supplied resolver", () => {
  it("lists cid: among the schemes, next to https: and mailto:", () => {
    expect(EMAIL_V1_PROFILE.urlSchemes).toEqual(expect.arrayContaining(["cid:", "https:", "mailto:"]));
    expect(ARTICLE_V1_PROFILE.urlSchemes).not.toContain("cid:");
  });

  it("replaces img src=cid:... with what the resolver returns, and hands it the decoded content-id", () => {
    const seen: string[] = [];
    const f = frag('<img src="cid:logo.123@mail.example" alt="logo">');
    const { rewrittenUrls } = enforceProfile(f, EMAIL_V1_PROFILE, {
      baseUrl: BASE,
      resolveCid: (cid) => {
        seen.push(cid);
        return "https://cdn.example/att/logo.png";
      },
    });
    expect(seen).toEqual(["logo.123@mail.example"]);
    expect(f.firstElementChild!.getAttribute("src")).toBe("https://cdn.example/att/logo.png");
    expect(rewrittenUrls.map((n) => n.reason)).toEqual(["cid-resolved"]);
  });

  it("percent-decodes the content-id and accepts any scheme case", () => {
    const seen: string[] = [];
    enforceProfile(frag('<img src="CID:a%20b%40c"><img src="Cid:%3Cx%3E">'), EMAIL_V1_PROFILE, {
      baseUrl: BASE,
      resolveCid: (cid) => (seen.push(cid), undefined),
    });
    expect(seen).toEqual(["a b@c", "<x>"]);
  });

  it("accepts blob: and image data: URLs from the resolver (caller-trusted attachment URLs)", () => {
    for (const ok of ["blob:https://app.example/1f2e", "data:image/png;base64,iVBORw0KGgo=", "data:image/jpeg;base64,/9j/4AAQ", "https://cdn.example/a.png"]) {
      const f = frag('<img src="cid:x">');
      enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE, resolveCid: () => ok });
      expect(f.firstElementChild!.getAttribute("src"), ok).toBe(ok);
    }
  });

  it("drops the attribute when there is no resolver (nothing is ever fetched or left as cid:)", () => {
    const f = frag('<img src="cid:x" alt="a">');
    const { rewrittenUrls } = enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE });
    expect(f.firstElementChild!.hasAttribute("src")).toBe(false);
    expect(f.firstElementChild!.getAttribute("alt")).toBe("a");
    expect(rewrittenUrls.map((n) => n.reason)).toEqual(["cid-unresolved"]);
  });

  const hostile: Array<[string, unknown]> = [
    ["javascript:", "javascript:alert(1)"],
    ["JaVa\\tScRiPt:", "java\tscript:alert(1)"],
    ["data: html", "data:text/html,<script>alert(1)</script>"],
    ["data: svg", "data:image/svg+xml,<svg onload=alert(1)>"],
    ["data: with a bad type", "data:application/javascript,alert(1)"],
    ["vbscript:", "vbscript:x"],
    ["file:", "file:///etc/passwd"],
    ["http: (not https)", "http://cdn.example/a.png"],
    ["protocol-relative", "//evil.example/x.png"],
    ["relative", "/logout"],
    ["empty", ""],
    ["a number", 42],
    ["an object", { toString: () => "https://x/" }],
    ["null", null],
    ["undefined", undefined],
    ["a cid: again", "cid:other"],
  ];
  for (const [name, value] of hostile) {
    it(`never lets the resolver put ${name} into the output`, () => {
      const f = frag('<img src="cid:x">');
      enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE, resolveCid: () => value as string });
      expect(f.firstElementChild!.hasAttribute("src")).toBe(false);
    });
  }

  it("treats a resolver that throws as unresolved", () => {
    const f = frag('<img src="cid:x">');
    enforceProfile(f, EMAIL_V1_PROFILE, {
      baseUrl: BASE,
      resolveCid: () => {
        throw new Error("boom");
      },
    });
    expect(f.firstElementChild!.hasAttribute("src")).toBe(false);
  });

  it("resolves cid: only where an image loads: img src and background; never a link or srcset", () => {
    const f = frag(
      '<a href="cid:x">l</a><img srcset="cid:x 1x" src="https://example.com/a.png"><table background="cid:bg"><tbody><tr><td>c</td></tr></tbody></table>',
    );
    const calls: string[] = [];
    const { rewrittenUrls } = enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE, resolveCid: (c) => (calls.push(c), "https://cdn.example/bg.png") });
    const html = serialize(f);
    expect(html).not.toContain("cid:");
    expect(f.querySelector("a")!.hasAttribute("href")).toBe(false);
    expect(calls).toEqual(["bg"]);
    expect(f.querySelector("table")!.getAttribute("background")).toBe("https://cdn.example/bg.png");
    expect(rewrittenUrls.map((n) => n.reason).sort()).toEqual(["cid-not-allowed-here", "cid-resolved"]);
  });

  it("never resolves cid: inside a srcset, even for a profile that allows srcset", () => {
    const p = deriveProfile("email-v1", { name: "cid-srcset-v1", addElements: { img: [...EMAIL_V1_PROFILE.elements.img!, "srcset"] } });
    const f = frag('<img srcset="cid:x 1x, https://cdn.example/b.png 2x" src="https://cdn.example/a.png">');
    const calls: string[] = [];
    enforceProfile(f, p, { baseUrl: BASE, resolveCid: (c) => (calls.push(c), "https://cdn.example/r.png") });
    expect(calls).toEqual([]);
    expect(f.firstElementChild!.hasAttribute("srcset")).toBe(false);
  });

  it("a profile without cid: in urlSchemes refuses it as an unknown scheme", () => {
    const f = frag('<img src="cid:x">');
    const { rewrittenUrls } = enforceProfile(f, ARTICLE_V1_PROFILE, { baseUrl: BASE, resolveCid: () => "https://cdn.example/a.png" });
    expect(f.firstElementChild!.hasAttribute("src")).toBe(false);
    expect(rewrittenUrls.map((n) => n.reason)).toEqual(["disallowed-url-scheme:cid:"]);
  });

  it("is reachable through sanitizeToFragment({ resolveCid })", async () => {
    const { fragment } = await sanitizeToFragment('<p>hi</p><img src="cid:pic1" alt="">', {
      profile: "email-v1",
      resolveCid: (cid) => `https://cdn.example/${cid}.png`,
    });
    expect(fragment.querySelector("img")!.getAttribute("src")).toBe("https://cdn.example/pic1.png");
    const none = await sanitizeToFragment('<img src="cid:pic1">', { profile: "email-v1" });
    expect(none.fragment.querySelector("img")!.hasAttribute("src")).toBe(false);
  });

  it("registerProfile accepts cid: and still refuses data:/javascript:", () => {
    const ok = registerProfile(deriveProfile("article-v1", { name: "cid-ok-v1", urlSchemes: ["relative", "https:", "cid:"] }));
    expect(ok.urlSchemes).toContain("cid:");
    unregisterProfile("cid-ok-v1");
    expect(() => registerProfile(deriveProfile("article-v1", { name: "cid-bad-v1", urlSchemes: ["data:"] }))).toThrow();
  });
});

describe("email-v1: MSO conditional comments and VML", () => {
  it("removes an MSO conditional comment and everything inside it", () => {
    const html =
      "<p>before</p><!--[if mso]><table><tr><td><img src=x onerror=alert(1)>OUTLOOK-ONLY</td></tr></table><v:rect><w:anchorlock/></v:rect><![endif]--><p>after</p>";
    const f = frag(html);
    enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE });
    expect(serialize(f)).toBe("<p>before</p><p>after</p>");
  });

  it("keeps the content of a downlevel-hidden `!mso` block (the non-Outlook version) and drops the comment markers", () => {
    const f = frag("<!--[if !mso]><!--><p>for everyone else</p><!--<![endif]-->");
    enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE });
    expect(serialize(f)).toBe("<p>for everyone else</p>");
  });

  it("downlevel-revealed markers (<![if mso]>) are bogus comments: gone, while their (sanitized) content stays", () => {
    const f = frag('<![if !mso]><p>x</p><img src=x onerror="alert(1)"><![endif]>');
    enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE });
    expect(serialize(f)).not.toContain("onerror");
    expect(serialize(f)).toContain("<p>x</p>");
  });

  it("drops VML and Office XML containers WITH their text, but unwraps <o:p>", () => {
    const f = frag(
      '<p>a</p><v:roundrect href="https://x" style="width:200px"><w:anchorlock></w:anchorlock><center>VML-BUTTON-TEXT</center></v:roundrect>' +
        "<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>" +
        '<v:imagedata src="javascript:alert(1)"></v:imagedata><p>b<o:p>&nbsp;</o:p></p>',
    );
    const { removedElements } = enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE });
    const text = f.textContent ?? "";
    expect(text).not.toContain("VML-BUTTON-TEXT");
    expect(text).not.toContain("96");
    expect(serialize(f)).not.toContain("javascript:");
    expect(serialize(f)).toBe("<p>a</p><p>b&nbsp;</p>");
    expect(removedElements.some((n) => n.tag === "v:roundrect" && n.reason === "element-dropped:dangerous-container")).toBe(true);
  });

  it("any element in a dropElements prefix (v:*, o:*, w:*) is dropped with its subtree, not just the listed ones", () => {
    const f = frag("<p>k</p><v:brandnewshape>LEAK</v:brandnewshape><w:madeup>LEAK2</w:madeup>");
    enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE });
    expect(serialize(f)).toBe("<p>k</p>");
  });
});

describe("email-v1: table layout attributes", () => {
  it("keeps the presentational attributes real mail relies on", () => {
    const f = frag(
      '<table width="600" align="center" bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" role="presentation"><tbody>' +
        '<tr bgcolor="#eee" valign="top"><td width="50%" height="20" align="left" valign="middle" bgcolor="#f00" colspan="2" rowspan="1" nowrap>x</td></tr></tbody></table>' +
        '<center><font color="#333" face="Arial" size="2">t</font></center><img src="https://cdn.example/a.png" width="1" height="1" border="0" align="left" hspace="2" vspace="2" alt="">',
    );
    const { removedAttributes } = enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE });
    expect(removedAttributes).toEqual([]);
    expect(f.querySelector("table")!.getAttribute("bgcolor")).toBe("#ffffff");
    expect(f.querySelector("td")!.hasAttribute("nowrap")).toBe(true);
    expect(f.querySelector("font")!.getAttribute("face")).toBe("Arial");
  });

  it("still removes style, event handlers and non-allowlisted attributes", () => {
    const f = frag(
      '<table style="x:y" onclick="alert(1)" data-x="1" class="c" foo="bar" width="100"><tbody><tr><td style="a:b" bgcolor="red">x</td></tr></tbody></table>',
    );
    enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE });
    const t = f.querySelector("table")!;
    expect([...t.attributes].map((a) => a.name)).toEqual(["width"]);
    expect([...f.querySelector("td")!.attributes].map((a) => a.name)).toEqual(["bgcolor"]);
  });

  it("checks background= like any URL: https and cid only, no javascript:, no relative auto-load", () => {
    for (const [value, kept] of [
      ["https://cdn.example/bg.png", true],
      ["javascript:alert(1)", false],
      ["/relative.png", false],
      ["data:image/png;base64,AAAA", false],
    ] as const) {
      const f = frag(`<table background="${value}"><tbody><tr><td>x</td></tr></tbody></table>`);
      enforceProfile(f, EMAIL_V1_PROFILE, { baseUrl: BASE });
      expect(f.querySelector("table")!.hasAttribute("background"), value).toBe(kept);
    }
  });
});
