import { describe, it, expect, afterEach } from "vitest";
import createDOMPurify from "dompurify";
import { sanitize, sanitizeSync } from "../../src/sanitize/index.js";
import { getDOMPurify, peekDOMPurify, setDOMPurifyLoader, type DOMPurifyFactory } from "../../src/sanitize/dompurify.js";
import { preloadSanitizer } from "../../src/sanitize/preload.js";
import { getProfile } from "../../src/policy/registry.js";
import { isSafeFragmentError } from "../../src/errors.js";

const article = getProfile("article-v1")!;
const frames: HTMLIFrameElement[] = [];

function makeFrame(csp?: string): Promise<Document> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.srcdoc = `<!doctype html><html><head>${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ""}</head><body></body></html>`;
    iframe.addEventListener("load", () => resolve(iframe.contentDocument!), { once: true });
    document.body.appendChild(iframe);
    frames.push(iframe);
  });
}

afterEach(() => {
  setDOMPurifyLoader(undefined);
  while (frames.length) frames.pop()!.remove();
});

const factory: DOMPurifyFactory = createDOMPurify as unknown as DOMPurifyFactory;

describe("DOMPurify instance caching (per window)", () => {
  it("creates exactly one instance per window across many renders", async () => {
    const doc = await makeFrame();
    const a = await getDOMPurify(doc.defaultView as Window);
    for (let i = 0; i < 5; i++) await sanitize(doc, "<p>x</p>", article, { forceEngine: "dompurify" });
    expect(peekDOMPurify(doc.defaultView)).toBe(a);
  });

  it("a different window gets its own instance", async () => {
    const d1 = await makeFrame();
    const d2 = await makeFrame();
    const a = await getDOMPurify(d1.defaultView as Window);
    const b = await getDOMPurify(d2.defaultView as Window);
    expect(a).not.toBe(b);
  });

  it("loads the factory once even when many windows/renders ask", async () => {
    let calls = 0;
    const loader = async (): Promise<DOMPurifyFactory> => {
      calls++;
      return factory;
    };
    const d1 = await makeFrame();
    const d2 = await makeFrame();
    await Promise.all([
      sanitize(d1, "<p>1</p>", article, { forceEngine: "dompurify", loadDOMPurify: loader }),
      sanitize(d2, "<p>2</p>", article, { forceEngine: "dompurify", loadDOMPurify: loader }),
      sanitize(d1, "<p>3</p>", article, { forceEngine: "dompurify", loadDOMPurify: loader }),
    ]);
    expect(calls).toBe(1);
  });
});

describe("Trusted Types enforced (CSP require-trusted-types-for 'script'; trusted-types dompurify)", () => {
  it("renders repeatedly with the fallback forced, without 'allow-duplicates'", async () => {
    const doc = await makeFrame("require-trusted-types-for 'script'; trusted-types dompurify");
    // Sanity: the CSP really is enforced in that frame.
    const win = doc.defaultView as Window & { trustedTypes?: { createPolicy(n: string, o: object): unknown } };
    expect(win.trustedTypes).toBeTruthy();
    expect(() => (doc.createElement("div").innerHTML = "<b>x</b>")).toThrow();

    for (let i = 0; i < 4; i++) {
      const { fragment } = await sanitize(doc, `<p>render ${i}</p><img src=x onerror=alert(1)>`, article, { forceEngine: "dompurify" });
      const host = doc.createElement("div");
      host.appendChild(fragment);
      expect(host.querySelector("p")!.textContent).toBe(`render ${i}`);
      expect(host.querySelector("img")!.hasAttribute("onerror")).toBe(false);
    }
  });
});

describe("loadDOMPurify / error guidance", () => {
  it("uses an app-supplied loader instead of import('dompurify')", async () => {
    let used = false;
    const doc = await makeFrame();
    setDOMPurifyLoader(async () => {
      used = true;
      return factory;
    });
    await sanitize(doc, "<p>x</p>", article, { forceEngine: "dompurify" });
    expect(used).toBe(true);
  });

  it("SANITIZER_UNAVAILABLE says how to fix it", async () => {
    const doc = await makeFrame();
    const failing = async (): Promise<DOMPurifyFactory> => {
      throw new TypeError("Failed to resolve module specifier 'dompurify'");
    };
    try {
      await sanitize(doc, "<p>x</p>", article, { forceEngine: "dompurify", loadDOMPurify: failing });
      expect.unreachable();
    } catch (error) {
      expect(isSafeFragmentError(error) && error.code).toBe("SANITIZER_UNAVAILABLE");
      expect((error as Error).message).toMatch(/import map/);
      expect((error as Error).message).toMatch(/loadDOMPurify/);
    }
  });

  it("a failed load is not cached forever (a later retry can succeed)", async () => {
    const doc = await makeFrame();
    const failing = async (): Promise<DOMPurifyFactory> => {
      throw new Error("offline");
    };
    await expect(sanitize(doc, "<p>x</p>", article, { forceEngine: "dompurify", loadDOMPurify: failing })).rejects.toMatchObject({
      code: "SANITIZER_UNAVAILABLE",
    });
    const { fragment } = await sanitize(doc, "<p>x</p>", article, { forceEngine: "dompurify", loadDOMPurify: async () => factory });
    expect(fragment.firstElementChild!.tagName).toBe("P");
  });
});

describe("preloadSanitizer + sync API readiness", () => {
  it("sanitizeSync throws SANITIZER_NOT_READY (fail closed) until DOMPurify is preloaded", async () => {
    const doc = await makeFrame();
    expect(() => sanitizeSync(doc, "<p>x</p>", article, { forceEngine: "dompurify" })).toThrowError(/preloadSanitizer/);
    try {
      sanitizeSync(doc, "<p>x</p>", article, { forceEngine: "dompurify" });
    } catch (error) {
      expect(isSafeFragmentError(error) && error.code).toBe("SANITIZER_NOT_READY");
    }
    expect(await preloadSanitizer({ document: doc, engine: "dompurify", loadDOMPurify: async () => factory })).toBe("dompurify");
    const { fragment } = sanitizeSync(doc, "<p>x<script>1</script></p>", article, { forceEngine: "dompurify" });
    expect(fragment.firstElementChild!.innerHTML).toBe("x");
  });

  it("preloadSanitizer resolves 'native' without loading anything when setHTML exists", async () => {
    const doc = await makeFrame();
    let loaded = false;
    const engine = await preloadSanitizer({
      document: doc,
      loadDOMPurify: async () => {
        loaded = true;
        return factory;
      },
    });
    const hasNative = typeof (doc.createElement("div") as unknown as { setHTML?: unknown }).setHTML === "function";
    expect(engine).toBe(hasNative ? "native" : "dompurify");
    expect(loaded).toBe(!hasNative);
  });
});
