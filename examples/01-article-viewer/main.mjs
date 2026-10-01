// Runnable example: article-v1 rendering a blog-post-shaped fixture that
// includes a deliberately dangerous payload, to show it gets neutralized
// rather than executed.
//
// Open examples/01-article-viewer/index.html via any static file server after
// `npm run build` (it imports the built ../../dist/index.js). Also
// exercised directly (imported and called) by
// test/integration/examples-smoke.test.ts in a real browser.

import { registerSafeFragment } from "../../dist/index.js";

const DANGEROUS_BUT_REALISTIC_POST = `
  <h1>Shipping safe-fragment</h1>
  <p>We spent the week on the sanitization pipeline. Here's a photo:</p>
  <img src="https://example.com/photo.jpg" alt="the team, sanitizing" />
  <p>Someone tried to sneak this into the CMS: <img src=x onerror="alert('pwned')"> -- it renders as a
  plain broken image, nothing executes.</p>
  <p>Also tried: <a href="javascript:alert(1)">click me</a> -- the link
  survives with its text but the href is gone.</p>
  <ul>
    <li>Native Sanitizer API / DOMPurify fallback</li>
    <li>Shared <code>enforceProfile()</code> allowlist pass</li>
  </ul>
`;

/**
 * Registers <safe-fragment>, renders the fixture above under article-v1
 * into `container`, and returns the element for inspection.
 */
export async function run(container, { tagName = "safe-fragment" } = {}) {
  registerSafeFragment({ tagName });

  const el = document.createElement(tagName);
  el.setAttribute("profile", "article-v1");
  container.appendChild(el);

  const renderPromise = new Promise((resolve) => {
    el.addEventListener("safe-fragment:render", (event) => resolve(event.detail.report), { once: true });
  });

  el.html = DANGEROUS_BUT_REALISTIC_POST;
  const report = await renderPromise;

  return { element: el, report };
}
