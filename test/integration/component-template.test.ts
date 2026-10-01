import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { sanitize } from "../../src/sanitize/index.js";
import { sanitizeToFragment, sanitizeToFragmentSync } from "../../src/sanitize/public.js";
import { getProfile, deriveProfile, registerProfile, unregisterProfile, listProfiles } from "../../src/policy/registry.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { registerSafeFragment } from "../../src/render/register.js";
import { UI_V1_PROFILE } from "../../src/profiles/ui-v1.js";
import * as api from "../../src/index.js";
import { XSS_CORPUS } from "../fixtures/xss-corpus.js";

const engines: Array<"native" | "dompurify"> = ["dompurify"];
if (hasNativeSanitizer(document)) engines.push("native");

function html(fragment: DocumentFragment): string {
  const host = document.createElement("div");
  host.appendChild(fragment);
  return host.innerHTML;
}

describe("component-template-v1 (safe-fragment#11)", () => {
  const profile = getProfile("component-template-v1")!;

  it("is a built-in, exported by name, with no custom elements", () => {
    expect(profile).toBeDefined();
    expect(listProfiles()).toContain("component-template-v1");
    expect(api.COMPONENT_TEMPLATE_V1).toBe("component-template-v1");
    expect(profile.customElements).toEqual([]);
    expect(profile.version).toBe(1);
    expect(Object.isFrozen(profile) && Object.isFrozen(profile.elements)).toBe(true);
  });

  it("matches ui-v1 apart from <slot> and part/slot/exportparts", () => {
    const composition = new Set(["part", "slot", "exportparts"]);
    expect(Object.keys(profile.elements).filter((t) => !(t in UI_V1_PROFILE.elements))).toEqual(["slot"]);
    for (const [tag, attrs] of Object.entries(UI_V1_PROFILE.elements)) {
      expect(profile.elements[tag]!.filter((a) => !composition.has(a))).toEqual([...attrs]);
      for (const a of composition) expect(profile.elements[tag], tag).toContain(a);
    }
    expect(profile.urlSchemes).toEqual(UI_V1_PROFILE.urlSchemes);
    expect(profile.urlAttributes).toEqual(UI_V1_PROFILE.urlAttributes);
    expect(profile.allowedDataAttributes).toEqual(UI_V1_PROFILE.allowedDataAttributes);
    expect(profile.blockRelativeAutoLoadUrls).toBe(UI_V1_PROFILE.blockRelativeAutoLoadUrls);
  });

  for (const engine of engines) {
    describe(`engine: ${engine}`, () => {
      it("keeps <slot name>, part, slot and exportparts", async () => {
        const { fragment, report } = await sanitize(
          document,
          '<div part="card" exportparts="a:b"><slot name="title"><b part="t">default</b></slot><span slot="x">s</span></div>',
          profile,
          { forceEngine: engine },
        );
        const out = html(fragment);
        expect(out).toContain('<slot name="title">');
        expect(out).toContain('part="card"');
        expect(out).toContain('exportparts="a:b"');
        expect(out).toContain('<span slot="x">');
        expect(report.removedElements).toEqual([]);
        expect(report.removedAttributes).toEqual([]);
      });

      it("ui-v1 defaults still apply: <style>, scripts, handlers, forms, javascript: URLs, style attribute", async () => {
        const { fragment } = await sanitize(
          document,
          '<style>p{}</style><p style="x" onclick="a()" id="k">p<script>1</script></p><form><input name=x></form><a href="javascript:1" part="l">a</a><slot name="s" onclick="b()"></slot>',
          profile,
          { forceEngine: engine },
        );
        const out = html(fragment);
        expect(out).not.toMatch(/<style|<script|<form|<input|onclick|javascript:|style=/);
        expect(out).toContain('id="user-content-k"');
        expect(out).toContain('<slot name="s">');
        expect(out).toContain('part="l"');
      });

      it("a derived recipe adds custom elements by caller-supplied prefix", async () => {
        const name = `my-template-${engine}-v1`;
        registerProfile(
          deriveProfile("component-template-v1", {
            name,
            customElements: [{ tag: "my-*", attributes: ["part", "slot", "exportparts", "variant", "src"] }],
          }),
        );
        try {
          const { fragment } = await sanitize(
            document,
            '<my-card variant="a" part="c" slot="s" onclick="x()" src="javascript:1"><slot></slot></my-card><other-card>t</other-card>',
            getProfile(name)!,
            { forceEngine: engine },
          );
          const out = html(fragment);
          expect(out).toContain('<my-card variant="a" part="c" slot="s">');
          expect(out).toContain("<slot></slot>");
          expect(out).not.toMatch(/onclick|javascript:|other-card/);
        } finally {
          unregisterProfile(name);
        }
      });
    });
  }
});

describe('idPolicy: "keep-in-shadow" (safe-fragment#11)', () => {
  const profile = getProfile("component-template-v1")!;
  const input =
    '<label for="a" id="l">x</label><input-ish></input-ish><button id="a" aria-controls="b" aria-labelledby="l">go</button><div id="b"><a href="#a">jump</a></div>';

  for (const engine of engines) {
    it(`engine: ${engine}: ids and references are left alone, everything else still enforced`, async () => {
      const { fragment } = await sanitize(document, input + '<img id="i" src="x" onerror="1()">', profile, { forceEngine: engine, idPolicy: "keep-in-shadow" });
      const out = html(fragment);
      expect(out).toContain('id="a"');
      expect(out).toContain('for="a"');
      expect(out).toContain('aria-controls="b"');
      expect(out).toContain('aria-labelledby="l"');
      expect(out).toContain('href="#a"');
      expect(out).not.toContain("user-content-");
      expect(out).not.toContain("onerror");
    });

    it(`engine: ${engine}: the default still prefixes`, async () => {
      const { fragment } = await sanitize(document, input, profile, { forceEngine: engine });
      expect(html(fragment)).toContain('id="user-content-a"');
      const explicit = await sanitize(document, input, profile, { forceEngine: engine, idPolicy: "prefix" });
      expect(html(explicit.fragment)).toContain('id="user-content-a"');
    });
  }

  for (const engine of engines) {
    it(`engine: ${engine}: ids and slot names that collide with document properties survive identically (SANITIZE_DOM is off)`, async () => {
      const { fragment } = await sanitize(document, '<slot name="title"></slot><p id="title" part="location">t</p>', profile, { forceEngine: engine });
      expect(html(fragment)).toBe('<slot name="title"></slot><p id="user-content-title" part="location">t</p>');
      const kept = await sanitize(document, '<p id="title">t</p>', profile, { forceEngine: engine, idPolicy: "keep-in-shadow" });
      expect(html(kept.fragment)).toBe('<p id="title">t</p>');
    });
  }

  for (const engine of engines) {
    it(`engine: ${engine}: colon-bearing non-URL values (exportparts, data-action) survive identically; URL attributes are still gated`, async () => {
      const { fragment } = await sanitize(
        document,
        '<div exportparts="a:b, c:d" data-action="cart:add" title="Note: x"><a href="javascript:1" part="p:q">l</a><img src="data:text/html,x"></div>',
        profile,
        { forceEngine: engine },
      );
      expect(html(fragment)).toBe('<div exportparts="a:b, c:d" data-action="cart:add" title="Note: x"><a part="p:q">l</a><img></div>');
    });
  }

  it("an unknown idPolicy is rejected, never treated as keep", async () => {
    await expect(sanitize(document, input, profile, { idPolicy: "none" as never })).rejects.toMatchObject({ code: "INVALID_OPTION" });
    await expect(sanitizeToFragment(input, { profile: "ui-v1", idPolicy: "keep" as never })).rejects.toMatchObject({ code: "INVALID_OPTION" });
  });

  it("sanitizeToFragment / sanitizeToFragmentSync accept it", async () => {
    const a = await sanitizeToFragment('<p id="x">t</p>', { profile: "ui-v1", idPolicy: "keep-in-shadow" });
    expect(html(a.fragment)).toBe('<p id="x">t</p>');
    if (hasNativeSanitizer(document)) {
      const b = sanitizeToFragmentSync('<p id="x">t</p>', { profile: "ui-v1", idPolicy: "keep-in-shadow" });
      expect(html(b.fragment)).toBe('<p id="x">t</p>');
    }
  });

  it("kept ids in a shadow root clobber nothing on window or document", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const { fragment } = await sanitizeToFragment('<div id="sfClobberProbe"></div><img id="location">', { profile: "ui-v1", idPolicy: "keep-in-shadow" });
    shadow.appendChild(fragment);
    expect((window as unknown as Record<string, unknown>)["sfClobberProbe"]).toBeUndefined();
    expect(document.getElementById("sfClobberProbe")).toBeNull();
    expect(document.location).toBeInstanceOf(Location);
    expect(shadow.getElementById("sfClobberProbe")).not.toBeNull();
    host.remove();
  });
});

describe('<safe-fragment id-policy="keep-in-shadow"> (safe-fragment#11)', () => {
  const TAG = "test-component-template";
  type El = HTMLElement & {
    html: string | null;
    profile: string;
    scope: "light" | "shadow";
    idPolicy: "prefix" | "keep-in-shadow";
    render(): Promise<{ status: string; error?: { code: string } }>;
    getRenderedRoot(): Element | null;
  };
  const live: HTMLElement[] = [];
  beforeAll(() => registerSafeFragment({ tagName: TAG }));
  afterEach(() => {
    while (live.length) live.pop()!.remove();
  });
  function make(attrs: Record<string, string>): El {
    const el = document.createElement(TAG) as El;
    el.setAttribute("render-mode", "manual");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.html = '<p id="keep">t</p>';
    document.body.appendChild(el);
    live.push(el);
    return el;
  }

  it("with scope=shadow the ids are kept", async () => {
    const el = make({ profile: "component-template-v1", scope: "shadow", "id-policy": "keep-in-shadow" });
    expect(el.idPolicy).toBe("keep-in-shadow");
    expect((await el.render()).status).toBe("rendered");
    expect(el.shadowRoot!.querySelector("#keep")).not.toBeNull();
  });

  it("without scope=shadow it is rejected (fail closed), and nothing renders", async () => {
    const el = make({ profile: "component-template-v1", "id-policy": "keep-in-shadow" });
    const result = await el.render();
    expect(result.status).toBe("rejected");
    expect(result.error?.code).toBe("INVALID_OPTION");
    expect(el.querySelector("#keep, #user-content-keep")).toBeNull();
  });

  it("the default (and any unknown value) prefixes", async () => {
    for (const attrs of [{}, { "id-policy": "garbage" }] as Array<Record<string, string>>) {
      const el = make({ profile: "component-template-v1", scope: "shadow", ...attrs });
      expect(el.idPolicy).toBe("prefix");
      await el.render();
      expect(el.shadowRoot!.querySelector("#user-content-keep")).not.toBeNull();
    }
  });

  it("switching the policy re-renders instead of showing stale ids", async () => {
    const el = make({ profile: "component-template-v1", scope: "shadow" });
    await el.render();
    expect(el.shadowRoot!.querySelector("#user-content-keep")).not.toBeNull();
    el.setAttribute("id-policy", "keep-in-shadow");
    await el.render();
    expect(el.shadowRoot!.querySelector("#keep")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#user-content-keep")).toBeNull();
  });
});

describe("the XSS corpus holds under component-template-v1, with either idPolicy", () => {
  const profile = getProfile("component-template-v1")!;
  const fixtures = XSS_CORPUS.filter((f) => f.profile === "ui-v1" || f.profile === "article-v1");
  for (const idPolicy of ["prefix", "keep-in-shadow"] as const) {
    for (const engine of engines) {
      it(`${engine} / ${idPolicy}: ${fixtures.length} fixtures leave no forbidden substring or attribute`, async () => {
        for (const f of fixtures) {
          const { fragment } = await sanitize(document, f.input, profile, { forceEngine: engine, idPolicy });
          const out = html(fragment).toLowerCase();
          for (const bad of f.forbiddenSubstrings) expect(out, `${f.name}: ${bad}`).not.toContain(bad.toLowerCase());
          const host = document.createElement("div");
          host.innerHTML = out;
          for (const { selector, attribute } of f.forbiddenAttributes ?? []) {
            for (const el of host.querySelectorAll(selector)) expect(el.hasAttribute(attribute), `${f.name}: ${selector}[${attribute}]`).toBe(false);
          }
        }
      });
    }
  }
});
