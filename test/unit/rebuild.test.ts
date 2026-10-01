import { describe, it, expect } from "vitest";
import { rebuildFragment } from "../../src/sanitize/rebuild.js";
import { sanitize } from "../../src/sanitize/index.js";
import { getProfile } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { serialize } from "../helpers/dom.js";

function fragmentFromHtml(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

describe("rebuildFragment", () => {
  it("drops the hidden customized-built-in `is` value that attribute removal cannot reach", () => {
    const frag = fragmentFromHtml('<span is="host-defined-ext">x</span>');
    const span = frag.firstElementChild!;
    span.removeAttribute("is"); // what an attribute allowlist does
    // (Chromium's serializer still re-emits the hidden is-value at this point; WebKit's does not -- not asserted.)
    expect(serialize(rebuildFragment(frag))).toBe("<span>x</span>");
  });

  it("preserves structure, attributes and text", () => {
    const frag = fragmentFromHtml('<div a="1" b="2"><p>t<em>e</em>x</p></div>text');
    expect(serialize(rebuildFragment(frag))).toBe('<div a="1" b="2"><p>t<em>e</em>x</p></div>text');
  });

  it("survives 20k levels of nesting without overflowing the stack", () => {
    const depth = 20_000;
    const root = document.createElement("div");
    let cur: Element = root;
    for (let i = 0; i < depth; i++) {
      const next = document.createElement("div");
      cur.appendChild(next);
      cur = next;
    }
    const frag = document.createDocumentFragment();
    frag.appendChild(root);
    const out = rebuildFragment(frag);
    let n = 0;
    for (let c: Element | null = out.firstElementChild; c; c = c.firstElementChild) n++;
    expect(n).toBe(depth + 1);
  });
});

describe("sanitize() output never carries an is-value (both engines)", () => {
  for (const engine of ["dompurify", "native"] as const) {
    it.skipIf(engine === "native" && !hasNativeSanitizer(document))(`engine: ${engine}`, async () => {
      const { fragment } = await sanitize(document, '<span is="host-defined-ext" id="a">x</span>', getProfile("article-v1")!, {
        forceEngine: engine,
      });
      expect(serialize(fragment)).toBe('<span id="user-content-a">x</span>');
    });
  }
});
