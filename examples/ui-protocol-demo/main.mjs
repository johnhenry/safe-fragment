// Runnable example: ui-v1 + data-action event delegation + an
// application-registered custom element.
//
// Open examples/ui-protocol-demo/index.html via a static file server after
// `npm run build`. Also exercised directly by
// test/integration/examples-smoke.test.ts.

import { registerSafeFragment, defineProfile } from "../../dist/index.js";

const UI_MARKUP = `
  <div class="toolbar">
    <button type="button" data-action="save">Save</button>
    <button type="button" data-action="delete">Delete</button>
    <rating-stars value="4" max="5"></rating-stars>
  </div>
`;

/**
 * Registers <safe-fragment>, a "rating-stars" custom element under
 * ui-v1's allowlist, wires up safe-fragment:action handling, and renders
 * the fixture markup above into `container`.
 */
export async function run(container, { tagName = "safe-fragment", onAction } = {}) {
  registerSafeFragment({ tagName });
  defineProfile("ui-v1", { customElements: [{ tag: "rating-stars", attributes: ["value", "max"] }] });

  const el = document.createElement(tagName);
  el.setAttribute("profile", "ui-v1");
  container.appendChild(el);

  const actions = [];
  el.addEventListener("safe-fragment:action", (event) => {
    actions.push(event.detail.action);
    onAction?.(event.detail);
  });

  const renderPromise = new Promise((resolve) => {
    el.addEventListener("safe-fragment:render", (event) => resolve(event.detail.report), { once: true });
  });

  el.html = UI_MARKUP;
  const report = await renderPromise;

  return { element: el, report, actions };
}
