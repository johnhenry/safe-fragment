import type { ProfileDefinition, CustomElementAllowlistEntry } from "./profile.js";
import { isValidClassEntry, isValidCustomElementName, isValidCustomElementPattern, RESERVED_CUSTOM_ELEMENT_NAMES } from "./profile.js";
import { PLAIN_TEXT_V1_PROFILE } from "../profiles/plain-text-v1.js";
import { ARTICLE_V1_PROFILE } from "../profiles/article-v1.js";
import { UI_V1_PROFILE } from "../profiles/ui-v1.js";
import { EMAIL_V1_PROFILE } from "../profiles/email-v1.js";
import { COMPONENT_TEMPLATE_V1_PROFILE } from "../profiles/component-template-v1.js";
import { DROP_SUBTREE_ELEMENTS } from "../sanitize/dangerous.js";
import { SafeFragmentError } from "../errors.js";
import { getSharedState } from "../shared-state.js";

const BUILTINS: readonly ProfileDefinition[] = [PLAIN_TEXT_V1_PROFILE, ARTICLE_V1_PROFILE, UI_V1_PROFILE, EMAIL_V1_PROFILE, COMPONENT_TEMPLATE_V1_PROFILE];

/** Process-wide registry, held in the shared (globalThis-keyed) state so the ESM and CJS builds see the same profiles. Created lazily; never touches a DOM global. */
function registry(): Map<string, ProfileDefinition> {
  const shared = getSharedState();
  if (!shared.profiles) {
    shared.profiles = new Map(BUILTINS.map((p) => [p.name, p]));
    shared.builtinNames = new Set(BUILTINS.map((p) => p.name));
  }
  return shared.profiles;
}

function isBuiltin(name: string): boolean {
  registry();
  return getSharedState().builtinNames!.has(name);
}

const FORBIDDEN_ELEMENTS: ReadonlySet<string> = new Set([...DROP_SUBTREE_ELEMENTS, "base", "meta", "link"]);
const DANGEROUS_URL_SCHEMES = ["javascript:", "data:", "vbscript:", "file:", "blob:"];
const DENIED_ATTRS = new Set(["formaction", "srcdoc", "action", "xlink:href", "style"]);
const PROFILE_NAME_CHARS_OK = (name: string): boolean => {
  if (name.length === 0 || name.length > 64) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x5f || c === 0x2e;
    if (!ok) return false;
  }
  return name.charCodeAt(0) >= 0x61 && name.charCodeAt(0) <= 0x7a;
};

function invalid(message: string, details?: Record<string, unknown>): SafeFragmentError {
  return new SafeFragmentError("INVALID_PROFILE", `safe-fragment: ${message}`, { details });
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function checkAttributeNames(where: string, attrs: readonly string[]): void {
  for (const raw of attrs) {
    const attr = raw.toLowerCase();
    if (attr !== raw) throw invalid(`${where}: attribute "${raw}" must be lowercase.`);
    if (attr.startsWith("on") || DENIED_ATTRS.has(attr)) {
      throw invalid(`${where}: attribute "${raw}" is never allowed in any profile (event handlers, formaction, srcdoc, action, xlink:href, style).`);
    }
  }
}

/**
 * Validates `definition` and returns a deeply frozen copy. Throws a typed
 * `SafeFragmentError` (`INVALID_PROFILE`, or `PROFILE_MISMATCH` when the name
 * and `version` disagree) for anything malformed -- never a raw `TypeError`,
 * and never a silent no-op. The checks are the ones a custom profile could
 * use to smuggle a bypass in: dangerous elements, event-handler and
 * `style` attributes, dangerous URL schemes.
 */
function validateAndFreeze(definition: ProfileDefinition): ProfileDefinition {
  const def = definition as unknown as Record<string, unknown> | null | undefined;
  if (typeof def !== "object" || def === null) throw invalid("a profile definition object is required.");
  const name = def.name;
  if (typeof name !== "string" || !PROFILE_NAME_CHARS_OK(name)) {
    throw invalid(`profile "name" must be a non-empty lowercase string of letters, digits, "-", "_" or "." (starting with a letter), up to 64 characters.`, {
      name,
    });
  }
  const version = def.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw invalid(`profile "${name}": "version" must be an integer >= 1.`);
  const suffix = name.lastIndexOf("-v");
  if (suffix !== -1) {
    const tail = name.slice(suffix + 2);
    if (tail.length > 0 && [...tail].every((ch) => ch >= "0" && ch <= "9") && Number(tail) !== version) {
      throw new SafeFragmentError("PROFILE_MISMATCH", `safe-fragment: profile "${name}" declares version ${version}, but its name says v${tail}.`, {
        details: { name, version },
      });
    }
  }
  if (def.mode !== "html" && def.mode !== "text") throw invalid(`profile "${name}": "mode" must be "html" or "text".`);
  if (typeof def.elements !== "object" || def.elements === null || Array.isArray(def.elements))
    throw invalid(`profile "${name}": "elements" must be an object mapping tag -> attribute list.`);
  if (!isStringArray(def.urlAttributes)) throw invalid(`profile "${name}": "urlAttributes" must be an array of strings.`);
  if (!isStringArray(def.urlSchemes)) throw invalid(`profile "${name}": "urlSchemes" must be an array of strings.`);
  if (!isStringArray(def.allowedDataAttributes)) throw invalid(`profile "${name}": "allowedDataAttributes" must be an array of strings.`);
  if (typeof def.allowStyleAttribute !== "boolean" || typeof def.blockRelativeAutoLoadUrls !== "boolean") {
    throw invalid(`profile "${name}": "allowStyleAttribute" and "blockRelativeAutoLoadUrls" must be booleans.`);
  }
  if (def.allowStyleAttribute) throw invalid(`profile "${name}": the style attribute can never be allowed (no profile may set allowStyleAttribute: true).`);
  if (!Array.isArray(def.customElements)) throw invalid(`profile "${name}": "customElements" must be an array.`);

  for (const scheme of def.urlSchemes) {
    if (DANGEROUS_URL_SCHEMES.includes(scheme.toLowerCase())) throw invalid(`profile "${name}": URL scheme "${scheme}" can never be allowed.`);
  }
  for (const attr of def.allowedDataAttributes) {
    if (!attr.startsWith("data-") || attr.length <= 5 || attr.includes("*") || attr !== attr.toLowerCase()) {
      throw invalid(`profile "${name}": allowedDataAttributes entry "${attr}" must be a full lowercase "data-..." name (no wildcards).`);
    }
  }

  const allowedClasses = def.allowedClasses;
  if (allowedClasses !== undefined && (!Array.isArray(allowedClasses) || !allowedClasses.every(isValidClassEntry))) {
    throw invalid(
      `profile "${name}": "allowedClasses" must be an array of class tokens or prefixes (e.g. "btn", "user-*"): no whitespace, at most one trailing "*", never a bare "*".`,
    );
  }
  const dropElements = def.dropElements;
  if (dropElements !== undefined) {
    if (!isStringArray(dropElements)) throw invalid(`profile "${name}": "dropElements" must be an array of lowercase element names.`);
    for (const tag of dropElements) {
      if (
        tag === "" ||
        tag !== tag.toLowerCase() ||
        tag.includes("*") ||
        [...tag].some((ch) => ch <= " " || ch === "<" || ch === ">" || ch === "/" || ch === '"' || ch === "'")
      ) {
        throw invalid(`profile "${name}": dropElements entry "${tag}" is not a valid lowercase element name.`);
      }
    }
  }
  if (def.svg !== undefined && def.svg !== "static") throw invalid(`profile "${name}": "svg" must be "static" or absent.`);
  if (def.mathml !== undefined && def.mathml !== "presentation") throw invalid(`profile "${name}": "mathml" must be "presentation" or absent.`);

  const elements: Record<string, readonly string[]> = {};
  for (const [tag, attrs] of Object.entries(def.elements as Record<string, unknown>)) {
    if (tag !== tag.toLowerCase()) throw invalid(`profile "${name}": element "${tag}" must be lowercase.`);
    if (FORBIDDEN_ELEMENTS.has(tag)) throw invalid(`profile "${name}": element <${tag}> can never be allowed (raw-text/embedding/foreign container).`);
    if (!isStringArray(attrs)) throw invalid(`profile "${name}": element <${tag}> needs an array of attribute names.`);
    checkAttributeNames(`profile "${name}" element <${tag}>`, attrs);
    elements[tag] = Object.freeze([...attrs]);
  }

  const customElements: CustomElementAllowlistEntry[] = [];
  const seen = new Set<string>();
  for (const entry of def.customElements as unknown[]) {
    const e = entry as Partial<CustomElementAllowlistEntry> | null;
    if (typeof e !== "object" || e === null || typeof e.tag !== "string" || !isStringArray(e.attributes)) {
      throw invalid(`profile "${name}": each customElements entry needs a string "tag" and an "attributes" array.`);
    }
    const tag = e.tag.toLowerCase();
    if (tag.endsWith("*")) {
      if (!isValidCustomElementPattern(tag))
        throw invalid(`profile "${name}": custom element pattern "${e.tag}" must be a hyphenated lowercase prefix followed by a single "*" (e.g. "ui--*").`);
    } else if (!tag.includes("-")) {
      throw invalid(`profile "${name}": custom element tag "${e.tag}" must contain a hyphen, per the Custom Elements spec.`);
    } else if (RESERVED_CUSTOM_ELEMENT_NAMES.includes(tag)) {
      throw invalid(`profile "${name}": "${e.tag}" is a reserved name and can never be a custom element.`);
    } else if (!isValidCustomElementName(tag)) {
      throw invalid(`profile "${name}": "${e.tag}" is not a valid custom element name.`);
    }
    if (seen.has(tag)) throw invalid(`profile "${name}": custom element "${e.tag}" is listed twice.`);
    seen.add(tag);
    const attributes = e.attributes.map((a) => a.toLowerCase());
    checkAttributeNames(`profile "${name}" custom element "${e.tag}"`, attributes);
    customElements.push(Object.freeze({ tag, attributes: Object.freeze(attributes) }));
  }

  return Object.freeze({
    name,
    version,
    mode: def.mode,
    elements: Object.freeze(elements),
    urlAttributes: Object.freeze([...def.urlAttributes].map((a) => a.toLowerCase())),
    urlSchemes: Object.freeze([...def.urlSchemes]),
    allowedDataAttributes: Object.freeze([...def.allowedDataAttributes]),
    allowStyleAttribute: false,
    customElements: Object.freeze(customElements),
    blockRelativeAutoLoadUrls: def.blockRelativeAutoLoadUrls,
    allowedClasses: Object.freeze([...((allowedClasses as readonly string[] | undefined) ?? [])]),
    dropElements: Object.freeze([...((dropElements as readonly string[] | undefined) ?? [])]),
    ...(def.svg ? { svg: def.svg as "static" } : {}),
    ...(def.mathml ? { mathml: def.mathml as "presentation" } : {}),
  });
}

/**
 * Registers a NEW profile under `definition.name`. The definition is
 * validated (typed `INVALID_PROFILE`/`PROFILE_MISMATCH` errors) and stored as
 * a deeply frozen copy. Built-in profiles can never be replaced, and an
 * existing registered name must be `unregisterProfile`d first -- profiles
 * are versioned allowlists, not mutable settings. Returns the frozen
 * profile as registered.
 */
export function registerProfile(definition: ProfileDefinition): ProfileDefinition {
  const frozen = validateAndFreeze(definition);
  const reg = registry();
  if (reg.has(frozen.name)) {
    throw invalid(
      isBuiltin(frozen.name)
        ? `"${frozen.name}" is a built-in profile and is immutable; derive a new profile with deriveProfile() under another name.`
        : `a profile named "${frozen.name}" is already registered; unregisterProfile() it first.`,
      { name: frozen.name },
    );
  }
  reg.set(frozen.name, frozen);
  return frozen;
}

/** Removes a profile added with `registerProfile`. Returns whether it existed. Built-in profiles cannot be unregistered. */
export function unregisterProfile(name: string): boolean {
  if (typeof name !== "string") throw invalid(`unregisterProfile() needs a profile name string.`);
  if (isBuiltin(name)) throw invalid(`"${name}" is a built-in profile and cannot be unregistered.`, { name });
  return registry().delete(name);
}

export interface DeriveProfileOverrides {
  /** Name of the new profile (required; must differ from the base). */
  name: string;
  /** Defaults to the base's `version`... which must then match the name's `-v<N>` suffix, so set it when the name changes version. */
  version?: number;
  /** Replaces the base's element map when given. */
  elements?: Readonly<Record<string, readonly string[]>>;
  /** Extra elements merged over the base's. */
  addElements?: Readonly<Record<string, readonly string[]>>;
  urlAttributes?: readonly string[];
  urlSchemes?: readonly string[];
  allowedDataAttributes?: readonly string[];
  /** Custom elements to allow (exact tags or `prefix-*` patterns); REPLACES the base's list. */
  customElements?: readonly CustomElementAllowlistEntry[];
  blockRelativeAutoLoadUrls?: boolean;
  /** Class tokens (exact, or `prefix*`) content may use; REPLACES the base's list. See `ProfileDefinition.allowedClasses`. */
  allowedClasses?: readonly string[];
  /** Extra drop-with-subtree element names; REPLACES the base's list. */
  dropElements?: readonly string[];
  /** Opt in to static SVG (`"static"`), or `null` to turn the base's off. */
  svg?: "static" | null;
  /** Opt in to MathML presentation elements (`"presentation"`), or `null` to turn the base's off. */
  mathml?: "presentation" | null;
}

function pick<K extends string, V>(key: K, override: V | null | undefined, base: V | undefined): Partial<Record<K, V>> {
  const value = override === undefined ? base : override === null ? undefined : override;
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * Builds (does not register) a new profile definition from a registered base
 * plus overrides. Pure: the base is never modified. Pass the result to
 * `registerProfile`. This is how an application adds custom elements,
 * `data-*` names, or an extra scheme to a built-in profile without
 * mutating it.
 */
export function deriveProfile(base: string | ProfileDefinition, overrides: DeriveProfileOverrides): ProfileDefinition {
  const baseDef = typeof base === "string" ? registry().get(base) : base;
  if (!baseDef) throw invalid(`deriveProfile("${String(base)}", ...) -- no such profile is registered.`, { base });
  if (typeof overrides !== "object" || overrides === null || typeof overrides.name !== "string")
    throw invalid(`deriveProfile() needs overrides with a "name".`);
  if (overrides.name === baseDef.name) throw invalid(`deriveProfile() must produce a differently named profile than its base ("${baseDef.name}").`);
  return {
    name: overrides.name,
    version: overrides.version ?? baseDef.version,
    mode: baseDef.mode,
    elements: { ...(overrides.elements ?? baseDef.elements), ...(overrides.addElements ?? {}) },
    urlAttributes: overrides.urlAttributes ?? baseDef.urlAttributes,
    urlSchemes: overrides.urlSchemes ?? baseDef.urlSchemes,
    allowedDataAttributes: overrides.allowedDataAttributes ?? baseDef.allowedDataAttributes,
    allowStyleAttribute: false,
    customElements: overrides.customElements ?? baseDef.customElements,
    blockRelativeAutoLoadUrls: overrides.blockRelativeAutoLoadUrls ?? baseDef.blockRelativeAutoLoadUrls,
    allowedClasses: overrides.allowedClasses ?? baseDef.allowedClasses,
    dropElements: overrides.dropElements ?? baseDef.dropElements,
    ...pick("svg", overrides.svg, baseDef.svg),
    ...pick("mathml", overrides.mathml, baseDef.mathml),
  };
}

/** Looks up a profile definition by name. Returns `undefined` for an unknown profile. */
export function getProfile(name: string): ProfileDefinition | undefined {
  return registry().get(name);
}

/** Lists all currently-registered profile names: the built-ins plus anything added via `registerProfile`. */
export function listProfiles(): readonly string[] {
  return [...registry().keys()];
}
