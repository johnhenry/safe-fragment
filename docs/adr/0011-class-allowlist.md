# ADR 0011: `class` is an allowlist (`allowedClasses`), and `ui-v1` allows none

## Status

Accepted. Resolves safe-fragment#7.

## Context

`ui-v1` (and anything derived from it) allowed `class`, with no check on the values.
Untrusted markup could therefore pick class names that the host page's stylesheet
already gives meaning: `.hidden`, `.sr-only`, `.admin-banner`, `.btn-danger`,
`.modal-backdrop`, a CSS framework's `position: fixed` utilities. That is UI redress
and spoofing (overlays, hiding content, styling a link as a trusted control) with no
script execution, and it works under every CSP.

Two designs were considered.

- **Prefixing**, like ids: rewrite every token to `user-<token>`, so author classes can
  never equal a host class.
- **An allowlist**: a profile names the class tokens (exact) or prefixes (`user-*`)
  its content may use; every other token is removed.

## Decision

**An allowlist.** `ProfileDefinition.allowedClasses` is a list of exact tokens or
prefixes ending in one `*`. `enforceProfile` splits `class` on ASCII whitespace, keeps
the tokens the list allows (case-sensitive), normalizes the separator to one space, and
removes the attribute when nothing is left. A lone `*`, whitespace, or a `*` anywhere
but the end is refused by `registerProfile` (`INVALID_PROFILE`): "allow everything" must
be spelled by listing something. Each removal is reported
(`class-not-allowlisted`, snippet = the removed tokens).

**`ui-v1` ships with an empty list**, so by default no class survives; so does
`component-template-v1` (it styles through `part`, and `<style>` is a non-goal, ADR 0006).
`article-v1` and `email-v1` do not list `class` at all. An application that styles its
own fragments derives a profile and names its classes:

```ts
registerProfile(deriveProfile("ui-v1", { name: "my-ui-v1", allowedClasses: ["user-*", "btn"] }));
```

Why not prefixing:

- It rewrites the author's tokens, so the author's own stylesheet and `querySelector`s
  (`.card`) silently stop matching; the author must know the transformation. An allowlist
  leaves what it keeps unchanged.
- It does not stop collisions inside the prefix space: a host that also uses `user-*`
  for its own classes is exposed again, and the host has no way to say so. An allowlist
  makes the host name exactly what content may use.
- It is not safe by default for a profile nobody reviewed: with prefixing, `class` stays
  allowed everywhere and the safe outcome depends on the prefix not being a host
  convention. The allowlist is closed by construction, like every other list in a profile.
- Ids are different: an id has to stay unique and referenceable, so the rewrite there
  keeps references working (`href="#x"`, `for`). A class has no references to keep.

## Consequences

- Behavior change for `ui-v1` and `component-template-v1`: `class` is dropped by default.
  The package is unreleased (0.0.0), so nobody is migrating; the benign corpus no longer
  asserts a surviving `class` for `ui-v1`.
- The attribute allowlists of the engines are unchanged (`class` is still a listed
  attribute name); `enforceProfile` does the token filtering identically for both.
- Not covered, as before: `part` (a styling hook the host stylesheet can target, the
  same class of exposure, ADR 0005), `id` (prefixed), and what a custom element does with
  a class it receives.
- The fuzzer registers a profile with `allowedClasses` and its independent verifier
  checks every surviving token against the list.
