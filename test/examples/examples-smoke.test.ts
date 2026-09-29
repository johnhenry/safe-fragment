import { describe, it, expect, afterEach } from "vitest";

const liveContainers: HTMLElement[] = [];
function makeContainer(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  liveContainers.push(div);
  return div;
}
afterEach(() => {
  while (liveContainers.length) liveContainers.pop()!.remove();
});

describe("examples (run against the built dist/, via npm run examples)", () => {
  it("article-viewer: renders the fixture post and neutralizes the embedded payloads", async () => {
    // @ts-expect-error -- resolved only after `npm run build` produces dist/; not part of the tsc project graph.
    const { run } = await import("../../examples/article-viewer/main.mjs");
    const container = makeContainer();
    const { element, report } = await run(container, { tagName: "example-article-viewer" });

    expect(report.profile).toBe("article-v1");
    const html = (element.getRenderedRoot() as Element).innerHTML;
    expect(html).toContain("Shipping safe-fragment");
    expect(html.toLowerCase()).not.toContain("onerror");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("ui-protocol-demo: data-action clicks dispatch safe-fragment:action", async () => {
    // @ts-expect-error -- see above.
    const { run } = await import("../../examples/ui-protocol-demo/main.mjs");
    const container = makeContainer();
    const { element } = await run(container, { tagName: "example-ui-protocol-demo" });

    const saveButton = element.querySelector('[data-action="save"]') as HTMLElement;
    expect(saveButton).toBeTruthy();

    const actionPromise = new Promise<string>((resolve) => {
      element.addEventListener("safe-fragment:action", (e: Event) => resolve((e as CustomEvent).detail.action), { once: true });
    });
    saveButton.click();
    await expect(actionPromise).resolves.toBe("save");

    // The custom element survived enforceProfile (it was registered via defineProfile).
    expect(element.querySelector("rating-stars")).toBeTruthy();
  });

  it("sandbox-playground: runs the sample code in isolation and reports back", async () => {
    // @ts-expect-error -- see above.
    const { run } = await import("../../examples/sandbox-playground/main.mjs");
    const container = makeContainer();
    const { messages, errors } = await run(container, { tagName: "example-sandbox-playground" });

    expect(errors).toEqual([]);
    const allText = messages.flatMap((m: { args: string[] }) => m.args).join(" ");
    expect(allText).toContain("Rendered.");
    expect(allText).toContain("Confirmed isolated from the host page");
  });
});
