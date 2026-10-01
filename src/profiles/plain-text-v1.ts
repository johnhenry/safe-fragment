import type { ProfileDefinition } from "../policy/profile.js";

/**
 * `plain-text-v1` -- no HTML parsing at all. Input is always rendered via
 * `textContent`, never `innerHTML`/a `DOMParser`/the Sanitizer API. This is
 * the profile to reach for when the content genuinely never needs markup
 * (usernames, comments-as-plain-text, log lines) -- it has zero attack
 * surface because no HTML parser ever runs on untrusted input.
 */
export const PLAIN_TEXT_V1: ProfileDefinition = Object.freeze({
  name: "plain-text-v1",
  mode: "text",
  elements: Object.freeze({}),
  urlAttributes: Object.freeze([]),
  urlSchemes: Object.freeze([]),
  allowDataAttributes: false,
  allowStyleAttribute: false,
  allowCustomElements: false,
});
