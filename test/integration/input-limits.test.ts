import { describe, it, expect, afterEach } from "vitest";
import { sanitize, DEFAULT_MAX_INPUT_LENGTH } from "../../src/sanitize/index.js";
import { sanitizeToFragment } from "../../src/index.js";
import { registerSafeFragment } from "../../src/render/register.js";
import { getProfile } from "../../src/policy/registry.js";
import type { SafeFragmentElement } from "../../src/render/element-types.js";

const live: HTMLElement[] = [];
afterEach(() => {
  while (live.length) live.pop()!.remove();
});

describe("maxInputLength", () => {
  it("defaults to 1,000,000 UTF-16 code units; one more is rejected with SOURCE_TOO_LARGE", async () => {
    expect(DEFAULT_MAX_INPUT_LENGTH).toBe(1_000_000);
    const profile = getProfile("plain-text-v1")!;
    await expect(sanitize(document, "a".repeat(DEFAULT_MAX_INPUT_LENGTH), profile)).resolves.toBeTruthy();
    await expect(sanitize(document, "a".repeat(DEFAULT_MAX_INPUT_LENGTH + 1), profile)).rejects.toMatchObject({
      code: "SOURCE_TOO_LARGE",
      details: { length: DEFAULT_MAX_INPUT_LENGTH + 1, limit: DEFAULT_MAX_INPUT_LENGTH },
    });
  });

  it("applies to HTML profiles too, before any parsing, and is configurable per call", async () => {
    await expect(sanitizeToFragment("<p>x</p>".repeat(50), { profile: "article-v1", maxInputLength: 100 })).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    await expect(sanitizeToFragment("<p>x</p>".repeat(50), { profile: "article-v1", maxInputLength: 1000 })).resolves.toBeTruthy();
  });

  it("<safe-fragment> rejects an oversized .html with SOURCE_TOO_LARGE, using registerSafeFragment({ maxInputLength }), and clears stale content", async () => {
    registerSafeFragment({ tagName: "sf-limit", maxInputLength: 200 });
    const el = document.createElement("sf-limit") as SafeFragmentElement;
    el.setAttribute("profile", "article-v1");
    el.setAttribute("render-mode", "manual");
    document.body.appendChild(el);
    live.push(el);
    el.html = "<p>small</p>";
    expect((await el.render()).status).toBe("rendered");
    el.html = "<p>x</p>".repeat(100);
    const result = await el.render();
    expect(result.status).toBe("rejected");
    expect(result.error?.code).toBe("SOURCE_TOO_LARGE");
    expect(el.getRenderedRoot()!.textContent).toBe("");
  });

  it("outputLength is a cheap approximation of the serialized size, not a serialization", async () => {
    const { report } = await sanitizeToFragment('<p id="a">hello <b>world</b></p>', { profile: "article-v1" });
    expect(report.outputLength).toBeGreaterThan(10);
    expect(report.outputLength).toBeLessThan(80);
  });
});
