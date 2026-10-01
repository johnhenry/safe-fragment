import { describe, it, expect, afterEach } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { getProfile, getCustomElementAllowlist } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { enforceProfile } from "../../src/sanitize/enforce.js";

const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

const mounted: Element[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.remove();
  delete (window as unknown as Record<string, unknown>).hostGlobal;
});

async function mount(html: string, profileName: string, engine: "native" | "dompurify"): Promise<HTMLElement> {
  const profile = getProfile(profileName)!;
  const { fragment } = await sanitize(document, html, profile, getCustomElementAllowlist(profileName), { forceEngine: engine });
  const host = document.createElement("div");
  host.appendChild(fragment);
  document.body.appendChild(host);
  mounted.push(host);
  return host;
}

for (const engine of engines) {
  describe(`DOM clobbering / id namespacing (engine: ${engine})`, () => {
    it("cannot clobber a window global via id (window.scriptUrl)", async () => {
      expect((window as unknown as Record<string, unknown>).scriptUrl).toBeUndefined();
      await mount('<img id="scriptUrl" src="https://x.example/a.png"><a id="location" href="https://x.example/">x</a>', "article-v1", engine);
      expect((window as unknown as Record<string, unknown>).scriptUrl).toBeUndefined();
      expect(typeof window.location).toBe("object");
      expect(window.location.href).toContain("http");
    });

    it("cannot clobber document properties or shadow host ids", async () => {
      const hostEl = document.createElement("div");
      hostEl.id = "app";
      document.body.appendChild(hostEl);
      mounted.push(hostEl);
      await mount('<p id="app">evil</p><form id="cookie"></form><img name="cookie" id="body">', "article-v1", engine);
      expect(document.getElementById("app")).toBe(hostEl);
      expect(document.body.tagName).toBe("BODY");
      expect(typeof document.cookie).toBe("string");
    });

    it("prefixes ids exactly once, identically in both engines", async () => {
      const host = await mount('<h2 id="sec">t</h2>', "article-v1", engine);
      expect(host.querySelector("h2")!.getAttribute("id")).toBe("user-content-sec");
    });

    it("fragment links still resolve inside the fragment", async () => {
      const host = await mount('<a href="#sec">jump</a><h2 id="sec">target</h2>', "article-v1", engine);
      const a = host.querySelector("a")!;
      expect(a.getAttribute("href")).toBe("#user-content-sec");
      const targetId = a.getAttribute("href")!.slice(1);
      expect(document.getElementById(targetId)).toBe(host.querySelector("h2"));
    });

    it("label[for] keeps working (ui-v1)", async () => {
      const host = await mount('<label for="go">Go</label><button id="go" type="button">x</button>', "ui-v1", engine);
      const label = host.querySelector("label")!;
      expect(label.control).toBe(host.querySelector("button"));
    });

    it("rewrites aria id-reference lists consistently (ui-v1)", async () => {
      const host = await mount(
        '<div id="a"></div><div id="b"></div><button type="button" aria-controls="a b" aria-labelledby="a" aria-describedby=" b  a " aria-owns="a">x</button>',
        "ui-v1",
        engine,
      );
      const btn = host.querySelector("button")!;
      expect(btn.getAttribute("aria-controls")).toBe("user-content-a user-content-b");
      expect(btn.getAttribute("aria-labelledby")).toBe("user-content-a");
      expect(btn.getAttribute("aria-describedby")).toBe("user-content-b user-content-a");
      expect(btn.getAttribute("aria-owns")).toBe("user-content-a");
    });

    it("rewrites table headers references (article-v1)", async () => {
      const host = await mount('<table><tr><th id="h1">h</th></tr><tr><td headers="h1">x</td></tr></table>', "article-v1", engine);
      expect(host.querySelector("td")!.getAttribute("headers")).toBe("user-content-h1");
    });

    it("leaves non-fragment hrefs alone and drops empty ids", async () => {
      const host = await mount('<a href="/page#x" id="">a</a><a href="#">b</a>', "article-v1", engine);
      const [a, b] = [...host.querySelectorAll("a")];
      expect(a!.getAttribute("href")).toBe("/page#x");
      expect(a!.hasAttribute("id")).toBe(false);
      expect(b!.getAttribute("href")).toBe("#");
    });
  });
}

describe("enforceProfile id namespacing (unit)", () => {
  it("prefixes author ids that already look prefixed (no special-casing)", () => {
    const t = document.createElement("template");
    t.innerHTML = '<p id="user-content-x">a</p><a href="#user-content-x">b</a>';
    enforceProfile(t.content, getProfile("article-v1")!, new Map());
    expect(t.content.querySelector("p")!.id).toBe("user-content-user-content-x");
    expect(t.content.querySelector("a")!.getAttribute("href")).toBe("#user-content-user-content-x");
  });
});
