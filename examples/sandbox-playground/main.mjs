// Runnable example: <example-sandbox> running a small live code sample in
// an isolated iframe -- distinct from <safe-fragment>; this component runs
// real, application-authored code on purpose. See
// src/sandbox/example-sandbox-element.ts and docs/adr/0001.
//
// Open examples/sandbox-playground/index.html via a static file server
// after `npm run build`. Also exercised directly by
// test/integration/examples-smoke.test.ts.

import { registerExampleSandbox } from "../../dist/index.js";

const SAMPLE_CODE = `
  document.getElementById("app").innerHTML = "<p>Hello from inside the sandboxed iframe.</p>";
  console.log("Rendered.");
  try {
    parent.document.title; // throws: no allow-same-origin, opaque origin
  } catch (e) {
    console.log("Confirmed isolated from the host page: " + e.name);
  }
`;

/**
 * Registers <example-sandbox>, runs SAMPLE_CODE, and resolves once the
 * sandbox reports it's ready. Returns the element plus arrays of every
 * console message / error the sandbox reported.
 */
export async function run(container, { tagName = "example-sandbox" } = {}) {
  registerExampleSandbox({ tagName });

  const el = document.createElement(tagName);
  el.setAttribute("height", "120px");
  container.appendChild(el);

  const messages = [];
  const errors = [];
  el.addEventListener("example-sandbox:message", (event) => messages.push(event.detail));
  el.addEventListener("example-sandbox:error", (event) => errors.push(event.detail));

  const readyPromise = new Promise((resolve) => {
    el.addEventListener("example-sandbox:ready", resolve, { once: true });
  });

  el.code = SAMPLE_CODE;
  el.run();
  await readyPromise;
  // Give the synchronous body of SAMPLE_CODE a tick to finish posting its
  // console messages back before returning.
  await new Promise((resolve) => setTimeout(resolve, 50));

  return { element: el, messages, errors };
}
