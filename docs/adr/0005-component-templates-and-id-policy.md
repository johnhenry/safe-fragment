# ADR 0005: Component templates: a composition profile, and ids kept only inside a shadow root

## Status

Accepted. Resolves the `<slot>`/`part` and `id` items of safe-fragment#11.

## Context

A web component's template is markup the component clones into its own shadow
root. Sanitizing it needs three things the built-ins did not offer:

1. `<slot>` and the `part`/`slot`/`exportparts` attributes. They were reachable
   only through a hand-written derived profile, undocumented.
2. Author ids left alone. Every surviving `id` is rewritten to
   `user-content-<id>` (and every reference with it), which closes DOM
   clobbering (`<img id=cookie>` shadowing `document.cookie`, `window.x`
   named access). Inside a shadow root nothing is reachable through
   `window`/`document` named access, so the rewrite buys nothing there and
   breaks components whose own script or stylesheet uses `#id` or
   `form-control="#id"`.
3. `<style>` (see [ADR 0006](0006-style-element-is-a-non-goal.md)).

## Decision

**A built-in `component-template-v1`.** `ui-v1` plus `<slot name>` and `part`,
`slot`, `exportparts` on every allowed element. Everything else (URL schemes,
`data-action`, forced `type="button"`, no forms/SVG/`style`) is `ui-v1`'s,
by construction (it is derived from the `ui-v1` definition). Custom elements are
not part of it: built-ins are immutable and the right prefix is the caller's
decision. The documented recipe is
`deriveProfile("component-template-v1", { name, customElements: [{ tag: "my-app-*", attributes: [..., "part", "slot", "exportparts"] }] })`.
Adding `slot`/`part` is not a bypass surface: they are inert token lists that
accept no URL and run nothing. `part` is a styling hook the host stylesheet can
target, the same class of exposure as `class` (safe-fragment#7).

**An opt-in `idPolicy: "keep-in-shadow"`.** Judged safe, with a hard
precondition, so it is accepted rather than declined:

- Named access on `window`/`document` (the clobbering vector) does not cross a
  shadow boundary; ids inside a shadow root are only visible to that root's own
  `getElementById`/`querySelector`.
- `<safe-fragment>` can enforce the precondition, so it does: `id-policy="keep-in-shadow"`
  is honored only with `scope="shadow"`; with `scope="light"` the render is
  **rejected** with `INVALID_OPTION` (never silently downgraded to prefixing,
  which would hide the misconfiguration). Switching either attribute re-renders.
- `sanitizeToFragment` cannot know where the caller inserts the fragment, so the
  option is explicit, its name carries the condition, an unknown value throws
  `INVALID_OPTION`, and the option's documentation states the risk. The default
  stays `"prefix"`.
- Remaining risk, documented: a kept id can collide with an id the component
  itself looks up (`shadowRoot.getElementById("submit")`), so this is for
  templates whose author the component trusts to that degree; it removes
  clobbering protection if the fragment is later inserted into light DOM.

Everything else still runs under `keep-in-shadow` (attribute allowlist, URL
checks, rebuild). Only the `id`/reference rewrite is skipped.

**`name` is namespaced separately, always.** `name` on elements that create
named properties (`img`, `form`, `iframe`, `object`, `embed`, `a`, `area`, and
form controls) is prefixed under every policy. No built-in allows it, but a
derived profile can. This replaces DOMPurify's `SANITIZE_DOM`, which is now off:
it dropped any id/name value that collides with a `document` or form property
(`<slot name="title">`, `<p id="title">`) on the DOMPurify engine only, so the
same template rendered differently in Safari. `<slot>` and custom elements keep
`name` verbatim.

**DOMPurify `ALLOW_UNKNOWN_PROTOCOLS: true`.** DOMPurify dropped any non-URL
attribute whose value merely looked like `scheme:` (`exportparts="a:b"`,
`data-action="cart:add"`), while the native engine kept it. `javascript:`,
`vbscript:` and `data:` values are still refused by DOMPurify, and every
URL-valued attribute goes through `checkUrl` in `enforceProfile`, the
actual scheme gate for both engines.

## Consequences

- Component templates are expressible without a bespoke profile, and the two
  engines agree on them.
- A new error code, `INVALID_OPTION`.
- The README, docs/profiles.md and docs/security-model.md state the `idPolicy`
  precondition. `http:` links are still dropped (`https:`, `mailto:` and relative
  only), form controls are still excluded, and neither is changed here.
