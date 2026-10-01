import { describe, it, expect, afterEach } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { getProfile, registerProfile, deriveProfile } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { serialize } from "../helpers/dom.js";

/**
 * The same input must produce byte-identical output (attribute order and
 * values included, no normalization) from both engines. Each case states the
 * ONE expected serialization, so a WebKit run (DOMPurify only) still checks
 * the value instead of passing vacuously.
 */
const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

registerProfile(deriveProfile("ui-v1", { name: "cross-engine-ui-v1", customElements: [{ tag: "my-widget", attributes: ["title"] }] }));

const cases: Array<{ name: string; profile: string; input: string; expected: string }> = [
  { name: 'href=" " is trimmed', profile: "article-v1", input: '<a href=" ">x</a>', expected: '<a href="">x</a>' },
  { name: "java script: is dropped", profile: "article-v1", input: '<a href="java script:alert(1)">x</a>', expected: "<a>x</a>" },
  { name: "javascript&#8203;: is dropped", profile: "article-v1", input: '<a href="javascript&#8203;:alert(1)">x</a>', expected: "<a>x</a>" },
  {
    name: 'target=" _blank" is trimmed and normalized',
    profile: "article-v1",
    input: '<a href="https://a.example/" target=" _blank">x</a>',
    expected: '<a href="https://a.example/" target="_blank" rel="noopener noreferrer">x</a>',
  },
  { name: "<my-widget is=x> carries no is value", profile: "cross-engine-ui-v1", input: "<my-widget is=x>t</my-widget>", expected: "<my-widget>t</my-widget>" },
  {
    name: "attribute order is source order",
    profile: "article-v1",
    input: '<a title=t href="https://a.example/" hreflang="en" id=x lang=en>x</a>',
    expected: '<a title="t" href="https://a.example/" id="user-content-x" lang="en">x</a>',
  },
  { name: "padded values are trimmed", profile: "article-v1", input: '<p title="  padded  ">x</p>', expected: '<p title="padded">x</p>' },
  {
    name: "disallowed element text is kept",
    profile: "article-v1",
    input: "<blockquote><custom>hi<script>1</script></custom></blockquote>",
    expected: "<blockquote>hi</blockquote>",
  },
];

for (const engine of engines) {
  describe(`cross-engine value parity (engine: ${engine})`, () => {
    for (const c of cases) {
      it(c.name, async () => {
        const { fragment } = await sanitize(document, c.input, getProfile(c.profile)!, { forceEngine: engine });
        expect(serialize(fragment)).toBe(c.expected);
      });
    }
  });
}

describe("ui-v1 references never reach host DOM (X5)", () => {
  const mounted: Element[] = [];
  afterEach(() => {
    while (mounted.length) mounted.pop()!.remove();
  });

  for (const engine of engines) {
    it(`a <label for> naming a host control does not target it, and a button cannot submit the host form (engine: ${engine})`, async () => {
      const hostForm = document.createElement("form");
      let submitted = 0;
      hostForm.addEventListener("submit", (e) => {
        e.preventDefault();
        submitted++;
      });
      hostForm.innerHTML = '<input id="hostControl" type="checkbox"><button id="hostSubmit" type="submit">ok</button>';
      document.body.appendChild(hostForm);
      mounted.push(hostForm);

      const { fragment } = await sanitize(
        document,
        '<label for="hostControl">click me</label><button form="hostForm">attacker</button><button>plain</button>',
        getProfile("ui-v1")!,
        { forceEngine: engine },
      );
      const holder = document.createElement("div");
      holder.appendChild(fragment);
      hostForm.appendChild(holder); // worst case: rendered INSIDE the host form

      const label = holder.querySelector("label")!;
      expect(label.control).toBeNull();
      const checkbox = hostForm.querySelector<HTMLInputElement>("#hostControl")!;
      label.click();
      expect(checkbox.checked).toBe(false);

      for (const b of holder.querySelectorAll("button")) {
        expect(b.type).toBe("button");
        expect(b.hasAttribute("form")).toBe(false);
        b.click();
      }
      expect(submitted).toBe(0);
    });
  }
});
