# safe-fragment examples

Runnable browser examples, each exercised headlessly by `test/examples/examples-smoke.test.ts` (`npm run examples`, which builds first and runs in Chromium, WebKit and Firefox). They import the **built** package (`../../dist/index.js`) and resolve `dompurify` through a per-page import map, so they work in Safari, which has no native `setHTML` and takes the DOMPurify path.

| Example                                              | Demonstrates                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-article-viewer/`](./01-article-viewer/)         | `article-v1` renders a blog-post fixture containing an `onerror` image and a `javascript:` link: the post, the image and the link text survive, the handler and the `href` are gone, and nothing executes.                                    |
| [`02-ui-protocol-demo/`](./02-ui-protocol-demo/)     | A profile derived from `ui-v1` (`deriveProfile` + `registerProfile`) keeps an allowlisted custom element, and clicking a `data-action` button dispatches `safe-fragment:action` to the host without the markup ever supplying code.           |
| [`03-sandbox-playground/`](./03-sandbox-playground/) | `<example-sandbox>` runs application-authored code in an `allow-scripts`-only iframe: console output comes back over `postMessage`, and the code cannot reach the host page's DOM.                                                            |
| [`04-playground/`](./04-playground/)                 | Interactive: the same hostile input rendered unprotected (raw `innerHTML` in a sandboxed iframe, so you can watch an attack fire), through `<safe-fragment>`, and as a before/after report; plus the `ui-v1` action protocol with a live log. |

## Running

```sh
npm run build && npx serve .   # then open /examples/04-playground/ (or any other directory above)
npm run examples               # headless smoke test of all four, in every configured browser
```

`npx serve .` needs the repo's `serve.json` (`cleanUrls: false`); without it `serve` rewrites `/examples/01-article-viewer/index.html` and the relative `./main.mjs` imports 404. Any static file server that serves the repo root works.

## Runtime requirements (honest edition)

- They need a **browser** (custom elements, `<iframe sandbox>`), not Node, and a prior `npm run build` (they import `dist/`).
- `dompurify` is resolved by the import map at the top of each `index.html`, pointing at `node_modules/dompurify/dist/purify.es.mjs`. Serve from the repo root so that relative path exists. In your own page, add the same map entry or pass `loadDOMPurify` (see the README's "No bundler / import map").
- Example `04` loads a placeholder image from `picsum.photos` as part of its default payload; offline it shows a broken image, which does not affect what it demonstrates.
- The smoke test drives each example's `run()` export directly. It does not open the pages through a static file server, so it cannot catch a bad import-map path or a `serve` URL-rewriting problem; open the pages once by hand after changing either.
