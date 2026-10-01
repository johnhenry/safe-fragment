import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { registerSafeFragment } from "../../src/render/register.js";
import type { SafeFragmentElement } from "../../src/render/element-types.js";

const TAG = "sf-lifecycle-state";
const originalFetch = globalThis.fetch;

beforeAll(() => {
  registerSafeFragment({ tagName: TAG, fetch: { enabled: true, allowedOrigins: [] } });
});

const live: HTMLElement[] = [];
function create(attrs: Record<string, string> = {}, parent: HTMLElement = document.body): SafeFragmentElement {
  const el = document.createElement(TAG) as SafeFragmentElement;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  live.push(el);
  return el;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  while (live.length) live.pop()!.remove();
});

async function settle(ms = 30): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** A fetch that stays pending until the test resolves it (or the request is aborted). */
function deferredFetch(): { calls: string[]; resolveAll(body: string): void } {
  const calls: string[] = [];
  const resolvers: Array<(r: Response) => void> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return new Promise<Response>((resolve, reject) => {
      resolvers.push(resolve);
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }) as typeof fetch;
  return {
    calls,
    resolveAll(body: string) {
      for (const r of resolvers.splice(0)) r(new Response(body, { status: 200 }));
    },
  };
}

const MARKUP = '<p>hello</p><button type="button" data-action="go">go</button>';

describe("configuration changes during an in-flight render", () => {
  it("automatic mode: a profile change mid-fetch supersedes it, and the new profile wins", async () => {
    const fetches = deferredFetch();
    const el = create({ profile: "ui-v1", src: "/doc" });
    await settle();
    expect(fetches.calls).toHaveLength(1);
    el.setAttribute("profile", "plain-text-v1");
    await settle();
    expect(fetches.calls).toHaveLength(2);
    fetches.resolveAll(MARKUP);
    await settle();
    // plain-text-v1 renders the markup as literal text: no elements at all.
    expect(el.getRenderedRoot()!.querySelector("button")).toBeNull();
    expect(el.getRenderedRoot()!.textContent).toContain("<button");
  });

  for (const [what, change] of [
    ["profile", (el: SafeFragmentElement) => el.setAttribute("profile", "plain-text-v1")],
    ["src", (el: SafeFragmentElement) => el.setAttribute("src", "/other")],
    ["scope", (el: SafeFragmentElement) => el.setAttribute("scope", "shadow")],
  ] as const) {
    it(`manual mode: a ${what} change mid-render means the in-flight render does not land`, async () => {
      const fetches = deferredFetch();
      const el = create({ profile: "ui-v1", src: "/doc", "render-mode": "manual" });
      const pending = el.render();
      await settle();
      expect(fetches.calls).toHaveLength(1);
      change(el);
      fetches.resolveAll(MARKUP);
      const result = await pending;
      expect(result.status).toBe("superseded");
      expect(el.getRenderedRoot()?.querySelector("button") ?? null).toBeNull();
    });
  }

  it("manual mode: an .html change mid-render means the in-flight render does not land", async () => {
    const fetches = deferredFetch();
    const el = create({ profile: "ui-v1", src: "/doc", "render-mode": "manual" });
    const pending = el.render();
    await settle();
    el.html = "<p>new</p>";
    fetches.resolveAll(MARKUP);
    expect((await pending).status).toBe("superseded");
  });
});

describe("loading=lazy gate", () => {
  it("unrelated attribute changes on a gated, offscreen element do not defeat the gate", async () => {
    const fetches = deferredFetch();
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;height:6000px;";
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;top:5000px;left:0;width:100px;height:40px;";
    wrap.appendChild(holder);
    document.body.appendChild(wrap);
    live.push(wrap);
    const el = create({ profile: "article-v1", src: "/doc", loading: "lazy" }, holder);
    await settle(60);
    expect(fetches.calls).toHaveLength(0);
    el.setAttribute("profile", "ui-v1");
    el.setAttribute("strict", "");
    el.setAttribute("render-mode", "auto");
    el.setAttribute("scope", "shadow");
    el.setAttribute("scope", "light");
    el.setAttribute("loading", "lazy");
    el.html = null;
    await settle(60);
    expect(fetches.calls).toHaveLength(0);
  });
});
