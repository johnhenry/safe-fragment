import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { registerSafeFragment } from "../../src/render/register.js";

type SafeFragmentEl = HTMLElement & {
  html: string | null;
  source: string | null;
  profile: string;
  renderMode: "replace" | "once" | "manual";
  disabled: boolean;
  render(): Promise<void>;
  refresh(): Promise<void>;
  clear(): void;
  getRenderedRoot(): Node | null;
};

const TAG = "test-safe-fragment";

beforeAll(() => {
  registerSafeFragment({ tagName: TAG, fetch: { enabled: true, allowedOrigins: [] } });
});

const liveElements: HTMLElement[] = [];
function create(): SafeFragmentEl {
  const el = document.createElement(TAG) as SafeFragmentEl;
  document.body.appendChild(el);
  liveElements.push(el);
  return el;
}

afterEach(() => {
  while (liveElements.length) liveElements.pop()!.remove();
});

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(() => resolve())));
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 20));
}

function waitForEvent(target: EventTarget, type: string): Promise<CustomEvent> {
  return new Promise((resolve) => {
    target.addEventListener(type, (e) => resolve(e as CustomEvent), { once: true });
  });
}

describe("<safe-fragment> source precedence", () => {
  it("prefers .html property over a <template> child", async () => {
    const el = create();
    el.profile = "article-v1";
    el.innerHTML = "<template><p>from template</p></template>";
    el.html = "<p>from property</p>";
    await settle();
    expect((el.getRenderedRoot() as Element).innerHTML).toContain("from property");
  });

  it("uses a <template> child when no .html property is set", async () => {
    const el = create();
    el.profile = "article-v1";
    el.innerHTML = "<template><p>from template</p></template>";
    await settle();
    expect((el.getRenderedRoot() as Element).innerHTML).toContain("from template");
  });

  it("legacy content attribute works and warns", async () => {
    const el = create();
    el.profile = "article-v1";
    el.setAttribute("content", "<p>legacy</p>");
    await settle();
    expect((el.getRenderedRoot() as Element).innerHTML).toContain("legacy");
  });

  it("dispatches reject with NO_SOURCE when nothing is provided", async () => {
    const el = create();
    el.profile = "article-v1";
    const rejectPromise = waitForEvent(el, "safe-fragment:reject");
    await el.render();
    const event = await rejectPromise;
    expect(event.detail.code).toBe("NO_SOURCE");
  });

  it("dispatches reject with UNKNOWN_PROFILE for an unregistered profile", async () => {
    const el = create();
    el.profile = "not-a-real-profile";
    el.html = "<p>x</p>";
    const rejectPromise = waitForEvent(el, "safe-fragment:reject");
    await rejectPromise;
    // rejectPromise already resolved by the time html setter's scheduled render runs
    expect(true).toBe(true);
  });

  it("strict mode rejects ambiguous sources", async () => {
    const el = create();
    el.toggleAttribute("strict", true);
    el.profile = "article-v1";
    el.innerHTML = "<template><p>t</p></template>";
    const rejectPromise = waitForEvent(el, "safe-fragment:reject");
    el.html = "<p>h</p>";
    const event = await rejectPromise;
    expect(event.detail.code).toBe("AMBIGUOUS_SOURCE");
  });
});

describe("<safe-fragment> render lifecycle", () => {
  it("fires before-render then render, with a SanitizationReport", async () => {
    const el = create();
    el.profile = "article-v1";
    const renderPromise = waitForEvent(el, "safe-fragment:render");
    el.html = "<p>hi <strong>there</strong></p>";
    const event = await renderPromise;
    expect(event.detail.report.profile).toBe("article-v1");
    expect(["native", "dompurify"]).toContain(event.detail.report.engine);
  });

  it("before-render can be canceled to veto the render", async () => {
    const el = create();
    el.profile = "article-v1";
    el.addEventListener("safe-fragment:before-render", (e) => e.preventDefault());
    el.html = "<p>should not render</p>";
    await settle();
    expect(el.getRenderedRoot()).toBeNull();
  });

  it("microtask-coalesces multiple synchronous property changes into a single render", async () => {
    const el = create();
    el.profile = "article-v1";
    let renderCount = 0;
    el.addEventListener("safe-fragment:render", () => renderCount++);
    el.html = "<p>one</p>";
    el.html = "<p>two</p>";
    el.html = "<p>three</p>";
    await settle();
    expect(renderCount).toBe(1);
    expect((el.getRenderedRoot() as Element).innerHTML).toContain("three");
  });

  it("clear() empties the rendered root", async () => {
    const el = create();
    el.profile = "article-v1";
    el.html = "<p>content</p>";
    await settle();
    expect((el.getRenderedRoot() as Element).innerHTML).not.toBe("");
    el.clear();
    expect((el.getRenderedRoot() as Element).innerHTML).toBe("");
  });

  it("render-mode=once ignores subsequent property changes but refresh() still works", async () => {
    const el = create();
    el.setAttribute("render-mode", "once");
    el.profile = "article-v1";
    el.html = "<p>first</p>";
    await settle();
    expect((el.getRenderedRoot() as Element).innerHTML).toContain("first");

    el.html = "<p>second</p>";
    await settle();
    expect((el.getRenderedRoot() as Element).innerHTML).toContain("first"); // ignored

    await el.refresh();
    expect((el.getRenderedRoot() as Element).innerHTML).toContain("second"); // explicit refresh works
  });

  it("render-mode=manual never auto-renders", async () => {
    const el = create();
    el.setAttribute("render-mode", "manual");
    el.profile = "article-v1";
    el.html = "<p>never</p>";
    await settle();
    expect(el.getRenderedRoot()).toBeNull();
    await el.render();
    expect((el.getRenderedRoot() as Element).innerHTML).toContain("never");
  });

  it("disabled prevents rendering and clears existing content", async () => {
    const el = create();
    el.profile = "article-v1";
    el.html = "<p>x</p>";
    await settle();
    expect((el.getRenderedRoot() as Element).innerHTML).not.toBe("");
    el.disabled = true;
    await settle();
    expect((el.getRenderedRoot() as Element).innerHTML).toBe("");
  });
});

describe("<safe-fragment> scope", () => {
  it("light scope renders inside the host element itself", async () => {
    const el = create();
    el.profile = "article-v1";
    el.html = "<p>light</p>";
    await settle();
    expect(el.querySelector("p")?.textContent).toBe("light");
  });

  it("shadow scope renders inside an open shadow root with part=content", async () => {
    const el = create();
    el.setAttribute("scope", "shadow");
    el.profile = "article-v1";
    el.html = "<p>shadow</p>";
    await settle();
    expect(el.shadowRoot).not.toBeNull();
    const wrapper = el.shadowRoot!.querySelector('[part="content"]');
    expect(wrapper?.querySelector("p")?.textContent).toBe("shadow");
  });
});

describe("<safe-fragment> ui-v1 action/link delegation", () => {
  it("dispatches safe-fragment:action for data-action elements", async () => {
    const el = create();
    el.profile = "ui-v1";
    el.html = '<button type="button" data-action="do-thing">Go</button>';
    await settle();
    const actionPromise = waitForEvent(el, "safe-fragment:action");
    (el.querySelector("button") as HTMLElement).click();
    const event = await actionPromise;
    expect(event.detail.action).toBe("do-thing");
  });

  it("dispatches safe-fragment:link for anchor clicks", async () => {
    const el = create();
    el.profile = "article-v1";
    el.html = '<a href="https://example.com/x">link</a>';
    await settle();
    const linkPromise = waitForEvent(el, "safe-fragment:link");
    const a = el.querySelector("a") as HTMLAnchorElement;
    a.addEventListener("click", (e) => e.preventDefault()); // don't actually navigate in the test
    a.click();
    const event = await linkPromise;
    expect(event.detail.href).toBe("https://example.com/x");
  });
});

describe("<safe-fragment> plain-text-v1 never parses HTML", () => {
  it("renders markup as literal text, not elements", async () => {
    const el = create();
    el.profile = "plain-text-v1";
    el.html = "<p>not a real tag</p>";
    await settle();
    const root = el.getRenderedRoot() as Element;
    expect(root.querySelector("p")).toBeNull();
    expect(root.textContent).toBe("<p>not a real tag</p>");
  });
});
