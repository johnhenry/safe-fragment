import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { registerSafeFragment } from "../../src/render/register.js";
import type { SafeFragmentElement } from "../../src/render/element-types.js";

const TAG = "sf-lifecycle";
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
  window.scrollTo(0, 0);
});

async function settle(ms = 30): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(() => resolve())));
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Polls until `predicate` holds (IntersectionObserver delivery timing differs between engines). */
async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function waitFor(target: EventTarget, type: string): Promise<CustomEvent> {
  return new Promise((resolve) => target.addEventListener(type, (e) => resolve(e as CustomEvent), { once: true }));
}

function count(el: HTMLElement, type: string): { n: number } {
  const c = { n: 0 };
  el.addEventListener(type, () => c.n++);
  return c;
}

/** A fetch that stays pending until the test resolves it (or the request is aborted). */
function deferredFetch(): { calls: Array<{ url: string; signal: AbortSignal | null | undefined }>; resolveAll(body: string): void } {
  const calls: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];
  const resolvers: Array<(r: Response) => void> = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), signal: init?.signal });
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

function spacerParent(): HTMLElement {
  // Pushes its child far below the viewport so an IntersectionObserver sees it as not intersecting.
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;height:6000px;";
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;top:5000px;left:0;width:100px;height:40px;";
  wrap.appendChild(holder);
  document.body.appendChild(wrap);
  live.push(wrap);
  return holder;
}

describe("upgrade-property pass", () => {
  it("replays properties set before the element was upgraded", async () => {
    const tag = "sf-upgrade-late";
    const el = document.createElement(tag) as SafeFragmentElement;
    el.html = "<p>early</p>";
    el.profile = "article-v1";
    el.scope = "shadow";
    el.strict = true;
    el.debug = true;
    document.body.appendChild(el);
    live.push(el);
    registerSafeFragment({ tagName: tag });
    await settle();
    expect(el.shadowRoot?.querySelector("p")?.textContent).toBe("early");
    expect(el.getAttribute("scope")).toBe("shadow");
    expect(el.hasAttribute("strict")).toBe(true);
    expect(el.hasAttribute("debug")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(el, "html")).toBe(false);
  });
});

describe("render() result object", () => {
  it("resolves rendered with the report", async () => {
    const el = create({ profile: "article-v1", "render-mode": "manual" });
    el.html = "<p>ok</p>";
    const result = await el.render();
    expect(result.status).toBe("rendered");
    expect(result.report?.profile).toBe("article-v1");
  });

  it("resolves rejected with a typed error (and fires reject)", async () => {
    const el = create({ profile: "nope-v1", "render-mode": "manual" });
    el.html = "<p>ok</p>";
    const rejected = waitFor(el, "safe-fragment:reject");
    const result = await el.render();
    expect(result.status).toBe("rejected");
    expect(result.error?.code).toBe("UNKNOWN_PROFILE");
    expect((await rejected).detail.code).toBe("UNKNOWN_PROFILE");
  });

  it("resolves disabled with DISABLED when disabled", async () => {
    const el = create({ profile: "article-v1", disabled: "" });
    el.html = "<p>ok</p>";
    const result = await el.render();
    expect(result.status).toBe("disabled");
    expect(result.error?.code).toBe("DISABLED");
  });

  it("resolves superseded when a newer render overtakes it", async () => {
    const fetches = deferredFetch();
    const el = create({ profile: "article-v1", "render-mode": "manual", src: "/a" });
    const first = el.render();
    const second = el.render();
    await settle();
    fetches.resolveAll("<p>done</p>");
    expect((await first).status).toBe("superseded");
    expect((await first).error?.code).toBe("FETCH_SUPERSEDED");
    expect((await second).status).toBe("rendered");
  });

  it("a before-render veto rejects with RENDER_ABORTED and leaves existing content alone", async () => {
    const el = create({ profile: "article-v1", "render-mode": "manual" });
    el.html = "<p>first</p>";
    await el.render();
    el.addEventListener("safe-fragment:before-render", (e) => e.preventDefault());
    el.html = "<p>second</p>";
    const result = await el.render();
    expect(result.status).toBe("rejected");
    expect(result.error?.code).toBe("RENDER_ABORTED");
    expect(el.getRenderedRoot()!.textContent).toBe("first");
  });

  it("refresh() is exactly render()", async () => {
    const el = create({ profile: "article-v1", "render-mode": "manual" });
    el.html = "<p>x</p>";
    expect((await el.refresh()).status).toBe("rendered");
  });
});

describe("clear() and disabled cancel in-flight renders", () => {
  it("clear() mid-fetch: the stale render never lands", async () => {
    const fetches = deferredFetch();
    const el = create({ profile: "article-v1", "render-mode": "manual", src: "/a" });
    const pending = el.render();
    await settle();
    el.clear();
    fetches.resolveAll("<p>late</p>");
    const result = await pending;
    expect(result.status).toBe("superseded");
    await settle();
    expect(el.getRenderedRoot()?.textContent ?? "").toBe("");
  });

  it("disabling mid-fetch: the stale render never lands", async () => {
    const fetches = deferredFetch();
    const el = create({ profile: "article-v1", "render-mode": "manual", src: "/a" });
    const pending = el.render();
    await settle();
    el.disabled = true;
    fetches.resolveAll("<p>late</p>");
    expect((await pending).status).toBe("superseded");
    await settle();
    expect(el.getRenderedRoot()?.textContent ?? "").toBe("");
  });

  it("a render that finished its fetch but is cleared before landing does not land", async () => {
    const el = create({ profile: "article-v1", "render-mode": "manual" });
    el.html = "<p>x</p>";
    const pending = el.render(); // sanitize is async; clear synchronously after starting
    el.clear();
    expect((await pending).status).toBe("superseded");
    expect(el.getRenderedRoot()?.textContent ?? "").toBe("");
  });

  it("clear() and disable reset render-mode=once, so a later change renders again", async () => {
    const el = create({ profile: "article-v1", "render-mode": "once" });
    el.html = "<p>one</p>";
    await settle();
    expect(el.getRenderedRoot()!.textContent).toBe("one");
    el.html = "<p>ignored</p>";
    await settle();
    expect(el.getRenderedRoot()!.textContent).toBe("one");
    el.clear();
    el.html = "<p>two</p>";
    await settle();
    expect(el.getRenderedRoot()!.textContent).toBe("two");
    el.disabled = true;
    el.disabled = false;
    el.html = "<p>three</p>";
    await settle();
    expect(el.getRenderedRoot()!.textContent).toBe("three");
  });

  it("emits safe-fragment:clear and safe-fragment:disabled", async () => {
    const el = create({ profile: "article-v1" });
    el.html = "<p>x</p>";
    await settle();
    const cleared = waitFor(el, "safe-fragment:clear");
    el.clear();
    expect((await cleared).detail.reason).toBe("clear");

    el.html = "<p>y</p>";
    await settle();
    const clearedByDisable = waitFor(el, "safe-fragment:clear");
    const disabled = waitFor(el, "safe-fragment:disabled");
    el.disabled = true;
    expect((await clearedByDisable).detail.reason).toBe("disabled");
    await disabled;
  });
});

describe("a rejected re-render clears stale content", () => {
  it("unknown profile", async () => {
    const el = create({ profile: "article-v1" });
    el.html = "<p>visible</p>";
    await settle();
    expect(el.getRenderedRoot()!.textContent).toBe("visible");
    const cleared = waitFor(el, "safe-fragment:clear");
    el.profile = "not-registered-v1";
    await settle();
    expect(el.getRenderedRoot()!.textContent).toBe("");
    expect((await cleared).detail.reason).toBe("rejected");
  });

  it("null / undefined source", async () => {
    for (const empty of [null, undefined]) {
      const el = create({ profile: "article-v1" });
      el.html = "<p>visible</p>";
      await settle();
      const rejected = waitFor(el, "safe-fragment:reject");
      el.html = empty as unknown as null;
      expect((await rejected).detail.code).toBe("NO_SOURCE");
      expect(el.getRenderedRoot()!.textContent).toBe("");
    }
  });

  it("fetch failure", async () => {
    const el = create({ profile: "article-v1", "render-mode": "manual" });
    el.html = "<p>visible</p>";
    await el.render();
    el.html = null;
    globalThis.fetch = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    el.source = "/gone";
    const result = await el.render();
    expect(result.error?.code).toBe("FETCH_FAILED");
    expect(el.getRenderedRoot()!.textContent).toBe("");
  });

  it("non-string html rejects with INVALID_SOURCE instead of rendering [object Object]", async () => {
    const el = create({ profile: "plain-text-v1", "render-mode": "manual" });
    (el as unknown as { html: unknown }).html = { toString: () => "[object Object]" };
    const result = await el.render();
    expect(result.error?.code).toBe("INVALID_SOURCE");
    expect(el.getRenderedRoot()?.textContent ?? "").not.toContain("[object Object]");
  });
});

describe("scope handling", () => {
  it("switching scope removes the stale wrapper", async () => {
    const el = create({ profile: "article-v1" });
    el.html = "<p>hello</p>";
    await settle();
    expect(el.querySelector(":scope > [data-safe-fragment-root]")).not.toBeNull();
    el.scope = "shadow";
    await settle();
    expect(el.querySelector(":scope > [data-safe-fragment-root]")).toBeNull();
    expect(el.shadowRoot!.querySelector("p")!.textContent).toBe("hello");
    el.scope = "light";
    await settle();
    expect(el.shadowRoot!.querySelector("[data-safe-fragment-root]")).toBeNull();
    expect(el.querySelector(":scope > [data-safe-fragment-root] p")!.textContent).toBe("hello");
  });

  it("enumerated attributes are matched case-insensitively and the properties reflect", async () => {
    const el = create({ profile: "article-v1", scope: "SHADOW", "render-mode": "Manual", loading: "LAZY" });
    expect(el.scope).toBe("shadow");
    expect(el.renderMode).toBe("manual");
    expect(el.loading).toBe("lazy");
    el.loading = "eager";
    expect(el.getAttribute("loading")).toBe("eager");
    el.strict = true;
    expect(el.hasAttribute("strict")).toBe(true);
    el.debug = true;
    expect(el.hasAttribute("debug")).toBe(true);
  });

  it("scope=shadow: action and link delegation work through composedPath", async () => {
    const el = create({ profile: "ui-v1", scope: "shadow" });
    el.html = '<button type="button" data-action="go"><span id="inner">Go</span></button><a href="https://example.com/x">link</a>';
    await settle();
    const action = waitFor(el, "safe-fragment:action");
    el.shadowRoot!.querySelector<HTMLElement>("#user-content-inner")!.click();
    const detail = (await action).detail;
    expect(detail.action).toBe("go");
    expect(detail.element.localName).toBe("button");

    const link = waitFor(el, "safe-fragment:link");
    const a = el.shadowRoot!.querySelector("a")!;
    a.addEventListener("click", (e) => e.preventDefault());
    a.click();
    expect((await link).detail.href).toBe("https://example.com/x");
  });

  it("ignores data-action elements that are not inside the rendered root", async () => {
    const el = create({ profile: "ui-v1" });
    el.html = "<p>x</p>";
    await settle();
    const stray = document.createElement("button");
    stray.setAttribute("data-action", "stray");
    el.appendChild(stray); // host child outside the rendered wrapper
    const c = count(el, "safe-fragment:action");
    stray.click();
    expect(c.n).toBe(0);
  });
});

describe("before-render timing", () => {
  it("fires once per render that starts with a valid source and profile, never for invalid configurations", async () => {
    const noSource = create({ profile: "article-v1", "render-mode": "manual" });
    const noProfile = create({ "render-mode": "manual" });
    noProfile.html = "<p>x</p>";
    const unknown = create({ profile: "zzz-v1", "render-mode": "manual" });
    unknown.html = "<p>x</p>";
    const valid = create({ profile: "article-v1", "render-mode": "manual" });
    valid.html = "<p>x</p>";
    const counters = [noSource, noProfile, unknown, valid].map((e) => count(e, "safe-fragment:before-render"));
    await Promise.all([noSource.render(), noProfile.render(), unknown.render(), valid.render()]);
    expect(counters.map((c) => c.n)).toEqual([0, 0, 0, 1]);
  });
});

describe("DOM moves, lazy loading and teardown", () => {
  it("moving an element within the DOM neither re-renders nor refetches when nothing changed", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("<p>remote</p>", { status: 200 });
    }) as typeof fetch;
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);
    live.push(a, b);
    const el = create({ profile: "article-v1", src: "/doc" }, a);
    await settle();
    expect(calls).toHaveLength(1);
    const renders = count(el, "safe-fragment:render");
    b.appendChild(el);
    await settle();
    expect(calls).toHaveLength(1);
    expect(renders.n).toBe(0);
    expect(el.getRenderedRoot()!.textContent).toBe("remote");

    // ...but a changed source still re-renders after a move.
    el.profile = "plain-text-v1";
    await settle();
    expect(renders.n).toBe(1);
  });

  it("loading=lazy: src changes go through the gate, and a mid-fetch disconnect renders after reconnect", async () => {
    const fetches = deferredFetch();
    const holder = spacerParent();
    const el = create({ profile: "article-v1", src: "/one", loading: "lazy" }, holder);
    await settle(60);
    expect(fetches.calls).toHaveLength(0); // offscreen: not fetched

    el.setAttribute("src", "/two"); // still offscreen: still gated
    await settle(60);
    expect(fetches.calls).toHaveLength(0);

    holder.scrollIntoView({ block: "center" }); // the (sized) holder: an empty inline custom element has no box to scroll to
    await waitUntil(() => fetches.calls.length >= 1);
    expect(fetches.calls.map((c) => c.url)).toEqual([expect.stringContaining("/two")]);

    // Disconnect while the fetch is in flight, then reconnect (still in view).
    holder.removeChild(el);
    await settle();
    expect(fetches.calls[0]!.signal!.aborted).toBe(true);
    holder.appendChild(el);
    holder.scrollIntoView({ block: "center" }); // the (sized) holder: an empty inline custom element has no box to scroll to
    await waitUntil(() => fetches.calls.length >= 2);
    expect(fetches.calls).toHaveLength(2);
    fetches.resolveAll("<p>after reconnect</p>");
    await settle(60);
    expect(el.getRenderedRoot()!.textContent).toBe("after reconnect");
  });

  it("aborts an in-flight fetch when an <iframe> containing the element is removed", async () => {
    const fetches = deferredFetch();
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    live.push(iframe);
    const win = iframe.contentWindow! as Window & typeof globalThis;
    registerSafeFragment({
      tagName: "sf-in-iframe",
      // an about:blank iframe reports location.origin as "null"; allow the real one explicitly
      fetch: { enabled: true, allowedOrigins: [location.origin] },
      document: win.document,
      customElementRegistry: win.customElements,
      htmlElementBase: win.HTMLElement,
    });
    const el = win.document.createElement("sf-in-iframe") as SafeFragmentElement;
    el.setAttribute("profile", "article-v1");
    el.setAttribute("src", `${location.origin}/slow`);
    const rejects: string[] = [];
    el.addEventListener("safe-fragment:reject", (e) => rejects.push(e.detail.code + e.detail.message));
    win.document.body.appendChild(el);
    await settle();
    expect(rejects).toEqual([]);
    expect(fetches.calls).toHaveLength(1);
    expect(fetches.calls[0]!.signal!.aborted).toBe(false);
    iframe.remove();
    await settle();
    expect(fetches.calls[0]!.signal!.aborted).toBe(true);
  });

  it("moving the element to another document (popout) does not double-render", async () => {
    const el = create({ profile: "article-v1" });
    el.html = "<p>moved</p>";
    await settle();
    const renders = count(el, "safe-fragment:render");
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    live.push(iframe);
    iframe.contentDocument!.body.appendChild(el);
    await settle();
    expect(renders.n).toBe(0);
    expect(el.getRenderedRoot()!.textContent).toBe("moved");
  });
});

describe("template source edits and sourceKind", () => {
  it("re-renders when the <template> content, or the template itself, changes", async () => {
    const el = create({ profile: "article-v1" });
    el.innerHTML = "<template><p>v1</p></template>";
    await settle();
    expect(el.sourceKind).toBe("template-child");
    expect(el.getRenderedRoot()!.textContent).toBe("v1");

    el.querySelector("template")!.content.querySelector("p")!.textContent = "v2";
    await settle();
    expect(el.getRenderedRoot()!.textContent).toBe("v2");

    const fresh = document.createElement("template");
    fresh.innerHTML = "<p>v3</p>";
    el.querySelector("template")!.replaceWith(fresh);
    await settle();
    expect(el.getRenderedRoot()!.textContent).toBe("v3");
    fresh.content.querySelector("p")!.textContent = "v4";
    await settle();
    expect(el.getRenderedRoot()!.textContent).toBe("v4");
  });

  it("sourceKind reports the current source", () => {
    const el = create({ profile: "article-v1", "render-mode": "manual" });
    expect(el.sourceKind).toBe("none");
    el.setAttribute("content", "<p>c</p>");
    expect(el.sourceKind).toBe("content-attribute");
    el.source = "/x";
    expect(el.sourceKind).toBe("src");
    el.html = "<p>h</p>";
    expect(el.sourceKind).toBe("html-property");
    el.strict = true;
    expect(el.sourceKind).toBe("ambiguous");
  });
});
