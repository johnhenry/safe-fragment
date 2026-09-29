import type { ProfileDefinition, CustomElementAllowlistEntry } from "./profile.js";
import { PLAIN_TEXT_V1 } from "../profiles/plain-text-v1.js";
import { ARTICLE_V1 } from "../profiles/article-v1.js";
import { UI_V1 } from "../profiles/ui-v1.js";
import { EMAIL_V1 } from "../profiles/email-v1.js";

interface RegisteredProfile {
  definition: ProfileDefinition;
  /** Application-registered custom-element allowlist, keyed by tag name. Only meaningful when `definition.allowCustomElements` is true. */
  customElements: Map<string, CustomElementAllowlistEntry>;
}

/**
 * Process-wide profile registry. Module-level state is fine here (unlike
 * DOM globals) -- registering profiles has no dependency on `window` or
 * `document` and needs to work identically in Node/SSR so app code can
 * call `defineProfile` during module init without touching the DOM.
 */
const registry = new Map<string, RegisteredProfile>();

function seedBuiltins(): void {
  for (const def of [PLAIN_TEXT_V1, ARTICLE_V1, UI_V1, EMAIL_V1]) {
    if (!registry.has(def.name)) {
      registry.set(def.name, { definition: def, customElements: new Map() });
    }
  }
}
seedBuiltins();

export interface DefineProfileOptions {
  /**
   * Application-registered custom element allowlist for this profile.
   * Only usable on a profile whose `allowCustomElements` is `true` (only
   * `ui-v1` ships that way). Registering against a profile that doesn't
   * allow custom elements throws.
   */
  customElements?: readonly CustomElementAllowlistEntry[];
}

/**
 * Registers (or extends) a profile's custom-element allowlist. Built-in
 * profiles (`plain-text-v1`, `article-v1`, `ui-v1`, `email-v1`) already
 * exist in the registry; this is how an application adds its own custom
 * elements to `ui-v1` (or a future custom-element-capable profile) without
 * forking the whole allowlist. Calling this multiple times for the same
 * profile is additive (later calls add more tags; they do not replace
 * earlier ones).
 */
export function defineProfile(profileName: string, options: DefineProfileOptions): void {
  const entry = registry.get(profileName);
  if (!entry) {
    throw new RangeError(
      `safe-fragment: defineProfile("${profileName}", ...) -- no such profile is registered. ` +
        `Built-ins are "plain-text-v1", "article-v1", "ui-v1", "email-v1".`,
    );
  }
  if (options.customElements && options.customElements.length > 0 && !entry.definition.allowCustomElements) {
    throw new RangeError(
      `safe-fragment: defineProfile("${profileName}", ...) -- this profile does not allow custom elements ` +
        `(allowCustomElements is false). Only "ui-v1" ships with custom elements enabled.`,
    );
  }
  for (const custom of options.customElements ?? []) {
    const tag = custom.tag.toLowerCase();
    if (!tag.includes("-")) {
      throw new RangeError(
        `safe-fragment: defineProfile("${profileName}", ...) -- custom element tag "${custom.tag}" ` + `must contain a hyphen, per the Custom Elements spec.`,
      );
    }
    entry.customElements.set(tag, { tag, attributes: custom.attributes.map((a) => a.toLowerCase()) });
  }
}

/** Looks up a profile definition by name. Returns `undefined` for an unknown profile. */
export function getProfile(name: string): ProfileDefinition | undefined {
  return registry.get(name)?.definition;
}

/** Looks up the application-registered custom-element allowlist for a profile. Empty map if none registered. */
export function getCustomElementAllowlist(name: string): ReadonlyMap<string, CustomElementAllowlistEntry> {
  return registry.get(name)?.customElements ?? new Map();
}

/** Lists all currently-registered profile names (built-ins plus any registered via a future `registerProfileDefinition`, once/if that lands). */
export function listProfiles(): readonly string[] {
  return [...registry.keys()];
}
