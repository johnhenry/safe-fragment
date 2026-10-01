import type { ProfileDefinition } from "../policy/profile.js";
import { UI_V1_PROFILE } from "./ui-v1.js";

/**
 * Shadow-DOM composition attributes: `part` (styling hook for `::part()`),
 * `slot` (which named slot of the host an element is assigned to) and
 * `exportparts` (re-exports a nested part). All three are inert token lists:
 * none loads anything, runs anything or accepts a URL.
 */
const COMPOSITION_ATTRS = Object.freeze(["part", "slot", "exportparts"]);

function withComposition(attrs: readonly string[]): readonly string[] {
  return Object.freeze([...attrs, ...COMPOSITION_ATTRS.filter((a) => !attrs.includes(a))]);
}

/**
 * `component-template-v1` -- the markup of a web component's template,
 * i.e. what is about to be cloned into a shadow root. It is `ui-v1` (same
 * elements, attributes, URL schemes, `data-action`, forced `type="button"`,
 * id namespacing by default) plus shadow-DOM composition:
 *
 * - `<slot>` with `name`;
 * - `part`, `slot` and `exportparts` on every allowed element.
 *
 * Custom elements are not allowed as shipped (built-ins are immutable and
 * the right prefix is the caller's call). Derive a profile to add them, and
 * list `part`/`slot`/`exportparts` on each entry yourself:
 *
 * ```ts
 * registerProfile(deriveProfile("component-template-v1", {
 *   name: "my-app-template-v1",
 *   customElements: [{ tag: "my-app-*", attributes: ["part", "slot", "exportparts", "class", "id", "variant"] }],
 * }));
 * ```
 *
 * Still excluded, on purpose (see docs/profiles.md): `<style>` (docs/adr/0006),
 * forms and form controls, SVG/MathML, the `style` attribute, `srcset`,
 * `data-*` other than `data-action`. `part` is a styling hook the host
 * page's stylesheet can target, the same class of exposure as `class`
 * (safe-fragment#7).
 */
export const COMPONENT_TEMPLATE_V1_PROFILE: ProfileDefinition = Object.freeze({
  ...UI_V1_PROFILE,
  name: "component-template-v1",
  elements: Object.freeze({
    ...Object.fromEntries(Object.entries(UI_V1_PROFILE.elements).map(([tag, attrs]) => [tag, withComposition(attrs)])),
    slot: withComposition(["name"]),
  }),
});
