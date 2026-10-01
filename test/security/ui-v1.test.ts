import { describe, it, expect } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { getProfile, getCustomElementAllowlist } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";

const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

async function run(html: string, engine: "native" | "dompurify"): Promise<HTMLElement> {
  const { fragment } = await sanitize(document, html, getProfile("ui-v1")!, getCustomElementAllowlist("ui-v1"), { forceEngine: engine });
  const host = document.createElement("div");
  host.appendChild(fragment);
  return host;
}

for (const engine of engines) {
  describe(`ui-v1 hardening (engine: ${engine})`, () => {
    it("drops framework handler data-* attributes, keeps data-action", async () => {
      const host = await run('<div data-action="go" data-hx-on:click="alert(1)" data-hx-on--click="alert(1)" data-x-on="1" data-foo="bar">x</div>', engine);
      const div = host.querySelector("div")!;
      expect([...div.attributes].map((a) => a.name)).toEqual(["data-action"]);
    });

    it("buttons are always type=button", async () => {
      const host = await run('<button>a</button><button type="submit">b</button><button type="reset">c</button>', engine);
      expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("type"))).toEqual(["button", "button", "button"]);
    });
  });
}
