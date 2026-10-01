import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { registerExampleSandbox } from "../../src/sandbox/register.js";

type ExampleSandboxEl = HTMLElement & {
  code: string | null;
  run(): void;
  reset(): void;
};

const TAG = "test-example-sandbox";

beforeAll(() => {
  registerExampleSandbox({ tagName: TAG });
});

const liveElements: HTMLElement[] = [];
function create(): ExampleSandboxEl {
  const el = document.createElement(TAG) as ExampleSandboxEl;
  document.body.appendChild(el);
  liveElements.push(el);
  return el;
}
afterEach(() => {
  while (liveElements.length) liveElements.pop()!.remove();
});

function waitForEvent(target: EventTarget, type: string, timeoutMs = 3000): Promise<CustomEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
    target.addEventListener(
      type,
      (e) => {
        clearTimeout(timer);
        resolve(e as CustomEvent);
      },
      { once: true },
    );
  });
}

describe("<example-sandbox>", () => {
  it("builds an iframe sandboxed with only allow-scripts (no allow-same-origin, no allow-top-navigation)", async () => {
    const el = create();
    el.code = 'console.log("hi")';
    const readyPromise = waitForEvent(el, "example-sandbox:ready");
    el.run();
    await readyPromise;
    const iframe = el.querySelector("iframe")!;
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-popups");
  });

  it("forwards console.log calls from the sandboxed iframe as safe-fragment example-sandbox:message events", async () => {
    const el = create();
    el.code = 'console.log("hello from sandbox")';
    const messagePromise = waitForEvent(el, "example-sandbox:message");
    el.run();
    const event = await messagePromise;
    expect(event.detail.method).toBe("log");
    expect(event.detail.args).toContain("hello from sandbox");
  });

  it("forwards thrown errors from the sandboxed iframe as example-sandbox:error events", async () => {
    const el = create();
    el.code = 'throw new Error("boom")';
    const errorPromise = waitForEvent(el, "example-sandbox:error");
    el.run();
    const event = await errorPromise;
    expect(String(event.detail.message)).toContain("boom");
  });

  it("the sandboxed iframe cannot synchronously access the parent document (no allow-same-origin)", async () => {
    const el = create();
    // Accessing parent.document from a cross-origin (opaque, since no
    // allow-same-origin) frame throws a SecurityError -- caught and
    // reported as an example-sandbox:error, proving the isolation holds.
    el.code = 'try { parent.document.title; console.log("leaked"); } catch (e) { console.log("blocked: " + e.name); }';
    const messagePromise = waitForEvent(el, "example-sandbox:message");
    el.run();
    const event = await messagePromise;
    expect(String(event.detail.args)).toContain("blocked");
    expect(String(event.detail.args)).not.toContain("leaked");
  });

  it("run() tears down any previous iframe before creating a new one (no state leakage between runs)", async () => {
    const el = create();
    el.code = "console.log(1)";
    const ready1 = waitForEvent(el, "example-sandbox:ready");
    el.run();
    await ready1;
    const firstIframe = el.querySelector("iframe");
    expect(firstIframe).not.toBeNull();

    el.code = "console.log(2)";
    const ready2 = waitForEvent(el, "example-sandbox:ready");
    el.run();
    await ready2;
    const iframes = el.querySelectorAll("iframe");
    expect(iframes.length).toBe(1);
    expect(iframes[0]).not.toBe(firstIframe);
  });

  it("reset() removes the iframe", async () => {
    const el = create();
    el.code = "console.log(1)";
    const ready = waitForEvent(el, "example-sandbox:ready");
    el.run();
    await ready;
    expect(el.querySelector("iframe")).not.toBeNull();
    el.reset();
    expect(el.querySelector("iframe")).toBeNull();
  });

  it("supports a <template> child as the code source", async () => {
    const el = create();
    el.innerHTML = '<template>console.log("from template")</template>';
    const messagePromise = waitForEvent(el, "example-sandbox:message");
    el.run();
    const event = await messagePromise;
    expect(String(event.detail.args)).toContain("from template");
  });

  it("code containing </script> and <!-- cannot break out of the srcdoc script element", async () => {
    const el = create();
    el.code = 'console.log("a</script><img src=x onerror=console.log(\\"BREAKOUT\\")>b <!-- c"); console.log("after");';
    const messages: string[] = [];
    el.addEventListener("example-sandbox:message", (e) => messages.push(((e as CustomEvent).detail.args as string[]).join(" ")));
    const errors: string[] = [];
    el.addEventListener("example-sandbox:error", (e) => errors.push(String((e as CustomEvent).detail.message)));
    el.run();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(errors).toEqual([]);
    expect(messages).toEqual(['a</script><img src=x onerror=console.log("BREAKOUT")>b <!-- c', "after"]);
  });

  it("does not register a message listener, or append an iframe, when the srcdoc assignment fails (TT policy name not allowed by the CSP)", async () => {
    const iframeHost = document.createElement("iframe");
    iframeHost.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types some-other-policy">`;
    await new Promise<void>((resolve) => {
      iframeHost.addEventListener("load", () => resolve(), { once: true });
      document.body.appendChild(iframeHost);
    });
    const win = iframeHost.contentWindow as Window & typeof globalThis;
    let added = 0;
    const realAdd = win.addEventListener.bind(win);
    win.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === "message") added++;
      return (realAdd as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof win.addEventListener;

    registerExampleSandbox({ tagName: "sf-sandbox-tt", document: win.document, customElementRegistry: win.customElements, htmlElementBase: win.HTMLElement });
    const el = win.document.createElement("sf-sandbox-tt") as ExampleSandboxEl;
    el.code = "console.log(1)";
    win.document.body.appendChild(el);
    const errors: string[] = [];
    el.addEventListener("example-sandbox:error", (e) => errors.push(String((e as CustomEvent).detail.message)));
    el.run();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/safe-fragment-sandbox/);
    expect(added).toBe(0);
    expect(el.querySelector("iframe")).toBeNull();
    iframeHost.remove();
  });

  it("works end to end under an enforced Trusted Types CSP that allows the policy name", async () => {
    const iframeHost = document.createElement("iframe");
    iframeHost.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types safe-fragment-sandbox">`;
    await new Promise<void>((resolve) => {
      iframeHost.addEventListener("load", () => resolve(), { once: true });
      document.body.appendChild(iframeHost);
    });
    const win = iframeHost.contentWindow as Window & typeof globalThis;
    registerExampleSandbox({ tagName: "sf-sandbox-tt2", document: win.document, customElementRegistry: win.customElements, htmlElementBase: win.HTMLElement });
    const el = win.document.createElement("sf-sandbox-tt2") as ExampleSandboxEl;
    el.code = 'console.log("tt ok")';
    win.document.body.appendChild(el);
    const message = waitForEvent(el, "example-sandbox:message");
    el.run();
    expect(((await message).detail.args as string[]).join(" ")).toBe("tt ok");
    el.run(); // a second run in the same window reuses the cached policy (no duplicate-policy error)
    expect(((await waitForEvent(el, "example-sandbox:message")).detail.args as string[]).join(" ")).toBe("tt ok");
    iframeHost.remove();
  });
});
