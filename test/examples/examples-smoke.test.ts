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
  it("01-article-viewer: renders the fixture post and neutralizes the embedded payloads", async () => {
    // @ts-expect-error -- resolved only after `npm run build` produces dist/; not part of the tsc project graph.
    const { run } = await import("../../examples/01-article-viewer/main.mjs");
    const container = makeContainer();
    const { element, report } = await run(container, { tagName: "example-article-viewer" });

    expect(report.profile).toBe("article-v1");
    const html = (element.getRenderedRoot() as Element).innerHTML;
    expect(html).toContain("Shipping safe-fragment");
    expect(html.toLowerCase()).not.toContain("onerror");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("02-ui-protocol-demo: data-action clicks dispatch safe-fragment:action", async () => {
    // @ts-expect-error -- see above.
    const { run } = await import("../../examples/02-ui-protocol-demo/main.mjs");
    const container = makeContainer();
    const { element } = await run(container, { tagName: "example-ui-protocol-demo" });

    const saveButton = element.querySelector('[data-action="save"]') as HTMLElement;
    expect(saveButton).toBeTruthy();

    const actionPromise = new Promise<string>((resolve) => {
      element.addEventListener("safe-fragment:action", (e: Event) => resolve((e as CustomEvent).detail.action), { once: true });
    });
    saveButton.click();
    await expect(actionPromise).resolves.toBe("save");

    // The custom element survived enforceProfile (its profile was derived from ui-v1 with deriveProfile).
    expect(element.querySelector("rating-stars")).toBeTruthy();
  });

  it("03-sandbox-playground: runs the sample code in isolation and reports back", async () => {
    // @ts-expect-error -- see above.
    const { run } = await import("../../examples/03-sandbox-playground/main.mjs");
    const container = makeContainer();
    const { messages, errors } = await run(container, { tagName: "example-sandbox-playground" });

    expect(errors).toEqual([]);
    const allText = messages.flatMap((m: { args: string[] }) => m.args).join(" ");
    expect(allText).toContain("Rendered.");
    expect(allText).toContain("Confirmed isolated from the host page");
  });

  it("04-playground: default render neutralizes the fixture, and its own diff/report helpers agree with what actually rendered", async () => {
    // @ts-expect-error -- see above.
    const { run, renderProtected, dangerousPatternsIn, DEFAULT_PAYLOAD } = await import("../../examples/04-playground/main.mjs");
    const container = makeContainer();
    const { element, report } = await run(container, { tagName: "example-playground" });

    expect(report.profile).toBe("article-v1");
    const html = (element.getRenderedRoot() as Element).innerHTML;
    expect(html.toLowerCase()).not.toContain("onerror");
    expect(html.toLowerCase()).not.toContain("javascript:");
    expect(html.toLowerCase()).not.toContain("<script");

    // The demo's own before/after diff (not SanitizationReport, which only
    // tracks enforceProfile's own removals -- see AGENTS.md) must agree that
    // every dangerous pattern actually present in the fixture was neutralized.
    const diffs = dangerousPatternsIn(DEFAULT_PAYLOAD, html);
    expect(diffs.length).toBeGreaterThan(0);
    for (const d of diffs) expect(d.stillPresent).toBe(false);

    // renderProtected() must actually apply `.html` before awaiting its
    // result -- a prior version of this helper awaited first, deadlocking
    // every render into a spurious NO_SOURCE rejection.
    const container2 = makeContainer();
    const result = await renderProtected(container2, "<p>hi</p>", "article-v1", { tagName: "example-playground-2" });
    expect(result.rejected).toBeUndefined();
    expect(result.report?.profile).toBe("article-v1");
  });
});
