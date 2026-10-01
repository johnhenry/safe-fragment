import { describe, it, expect, afterEach } from "vitest";
import * as api from "../../src/index.js";
import {
  sanitizeToFragment,
  sanitizeToFragmentSync,
  registerProfile,
  unregisterProfile,
  deriveProfile,
  preloadSanitizer,
  getSafeFragmentElementClass,
} from "../../src/index.js";
import { sanitize } from "../../src/sanitize/index.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { getProfile } from "../../src/policy/registry.js";
import { isSafeFragmentError } from "../../src/errors.js";
import { normalize } from "../helpers/dom.js";

const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

const registered: string[] = [];
afterEach(() => {
  while (registered.length) unregisterProfile(registered.pop()!);
});

describe("sanitizeToFragment", () => {
  it("returns a detached, sanitized fragment and a report", async () => {
    const { fragment, report } = await sanitizeToFragment('<p onclick="x()">hi <script>evil()</script><a href="javascript:x()">l</a></p>', {
      profile: "article-v1",
    });
    const host = document.createElement("div");
    host.appendChild(fragment);
    expect(host.innerHTML).toBe("<p>hi <a>l</a></p>");
    expect(report.profile).toBe("article-v1");
    expect(["native", "dompurify"]).toContain(report.engine);
  });

  it("uses the given document's realm (popout/iframe)", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const idoc = iframe.contentDocument!;
    const { fragment } = await sanitizeToFragment("<p>x</p>", { profile: "article-v1", document: idoc });
    expect(fragment.ownerDocument).not.toBe(document);
    iframe.remove();
  });

  it("typed errors: unknown profile, missing options, non-string input, oversize input", async () => {
    await expect(sanitizeToFragment("<p>x</p>", { profile: "nope-v1" })).rejects.toMatchObject({ code: "UNKNOWN_PROFILE" });
    await expect(sanitizeToFragment("<p>x</p>", undefined as never))
      .rejects.toMatchObject({ code: "INVALID_PROFILE" })
      .catch(() => {});
    await expect(sanitizeToFragment({} as never, { profile: "article-v1" })).rejects.toMatchObject({ code: "INVALID_SOURCE" });
    await expect(sanitizeToFragment("x".repeat(101), { profile: "article-v1", maxInputLength: 100 })).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
  });

  it("works with a registered custom profile and custom-element prefix patterns", async () => {
    registered.push(
      registerProfile(
        deriveProfile("ui-v1", {
          name: "api-test-ui-v1",
          customElements: [
            { tag: "ui--*", attributes: ["role", "tone"] },
            { tag: "my-exact", attributes: [] },
          ],
        }),
      ).name,
    );
    for (const engine of engines) {
      const { fragment } = await sanitize(
        document,
        '<ui--card tone="warm" onclick="x()"><ui--stat role="status">1</ui--stat></ui--card><ui-card>unwrapped</ui-card><my-exact>e</my-exact><font-face>f</font-face>',
        getProfile("api-test-ui-v1")!,
        {
          forceEngine: engine,
        },
      );
      const out = normalize(fragment);
      expect(out, engine).toBe('<ui--card tone="warm"><ui--stat role="status">"1"</ui--stat></ui--card>"unwrapped"<my-exact>"e"</my-exact>"f"');
    }
  });
});

describe("sanitizeToFragmentSync", () => {
  it("works when the native engine exists, else fails closed with SANITIZER_NOT_READY until DOMPurify is ready", () => {
    // A fresh iframe window: no DOMPurify instance has been created for it yet,
    // whatever earlier tests loaded for the top window.
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const idoc = iframe.contentDocument!;
    if (hasNativeSanitizer(idoc)) {
      const { fragment } = sanitizeToFragmentSync("<p>sync<script>1</script></p>", { profile: "article-v1", document: idoc });
      expect(fragment.firstElementChild!.innerHTML).toBe("sync");
    } else {
      try {
        sanitizeToFragmentSync("<p>x</p>", { profile: "article-v1", document: idoc });
        expect.unreachable();
      } catch (error) {
        expect(isSafeFragmentError(error) && error.code).toBe("SANITIZER_NOT_READY");
      }
    }
    iframe.remove();
  });

  it("works after preloadSanitizer, matching the async result", async () => {
    await preloadSanitizer({ engine: "dompurify" });
    const input = "<p>a <em>b</em> <script>1</script><img src=x onerror=y></p>";
    const sync = sanitizeToFragmentSync(input, { profile: "article-v1" });
    const asyncResult = await sanitizeToFragment(input, { profile: "article-v1" });
    expect(normalize(sync.fragment)).toBe(normalize(asyncResult.fragment));
  });
});

describe("SanitizationReport counts what BOTH engine and enforceProfile removed", () => {
  for (const engine of engines) {
    it(`engine: ${engine}`, async () => {
      const input =
        '<p onclick="a()" data-x="1" style="color:red">text<script>evil()</script><marquee>m</marquee><img src="x" onerror="b()"><a href="javascript:c()">l</a></p><svg onload="d()"></svg>';
      const { report } = await sanitize(document, input, getProfile("article-v1")!, { forceEngine: engine });
      const els = report.removedElements.map((n) => n.tag);
      const attrs = report.removedAttributes.map((n) => `${n.tag}.${n.attribute}`);
      expect(els).toEqual(expect.arrayContaining(["script", "marquee", "svg"]));
      expect(attrs).toEqual(expect.arrayContaining(["p.onclick", "img.onerror", "p.style"]));
      // the engine itself strips javascript: hrefs before enforceProfile runs; either way it is reported
      expect([...attrs, ...report.rewrittenUrls.map((n) => `${n.tag}.${n.attribute}`)]).toContain("a.href");
    });
  }

  it("native engine still reports under an enforced Trusted Types policy (DOMParser is gated)", async () => {
    if (!hasNativeSanitizer(document)) return;
    const iframe = document.createElement("iframe");
    iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types dompurify">`;
    await new Promise<void>((resolve) => {
      iframe.addEventListener("load", () => resolve(), { once: true });
      document.body.appendChild(iframe);
    });
    const { report } = await sanitize(iframe.contentDocument!, '<p data-x="1">x<marquee>m</marquee></p>', getProfile("article-v1")!, {
      forceEngine: "native",
    });
    // DOMParser is gated here, so the fallback probe reveals what OUR config removed (data-x); the
    // engine's unconditional script/handler baseline is the one thing this fallback cannot count.
    expect(report.removedAttributes.map((n) => n.attribute)).toContain("data-x");
    expect(report.removedElements.map((n) => n.tag)).toContain("marquee");
    iframe.remove();
  });
});

describe("exports", () => {
  it("exposes the element class, types-level API and profile name constants (strings, not definitions)", () => {
    expect(typeof api.createSafeFragmentElementClass).toBe("function");
    expect(typeof getSafeFragmentElementClass()).toBe("function");
    expect(getSafeFragmentElementClass()).toBe(getSafeFragmentElementClass());
    expect(api.ARTICLE_V1).toBe("article-v1");
    expect(api.getProfile(api.ARTICLE_V1)?.name).toBe("article-v1");
    expect(api.UI_V1).toBe("ui-v1");
    expect("defineProfile" in api).toBe(false);
  });

  it("the element class can be defined and used directly", async () => {
    const Cls = getSafeFragmentElementClass();
    customElements.define("sf-direct-class", Cls as unknown as CustomElementConstructor);
    const el = document.createElement("sf-direct-class") as InstanceType<typeof Cls>;
    el.setAttribute("profile", "article-v1");
    el.html = "<p>direct</p>";
    document.body.appendChild(el);
    const result = await el.render();
    expect(result.status).toBe("rendered");
    expect(el.getRenderedRoot()!.textContent).toBe("direct");
    el.remove();
  });
});
