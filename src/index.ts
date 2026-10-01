/**
 * @johnhenry/safe-fragment -- public API.
 *
 * Importing this module never touches `window`/`document`/`HTMLElement`/
 * `customElements`; it is safe to import from Node/SSR. Nothing renders,
 * and no custom element is defined, until an application explicitly calls
 * `registerSafeFragment()` (and, separately, `registerExampleSandbox()`)
 * from code that actually runs in a browser.
 *
 * There is no "unsafe"/"trusted"/"allowScripts" escape hatch anywhere in
 * this API, by design -- see docs/security-model.md.
 */

export { registerSafeFragment, getSafeFragmentElementClass } from "./render/register.js";
export { createSafeFragmentElementClass } from "./render/safe-fragment-element.js";
export type { SafeFragmentElementDeps } from "./render/safe-fragment-element.js";
export type { SafeFragmentElement, SafeFragmentEventMap } from "./render/element-types.js";
export type { RegisterSafeFragmentOptions } from "./render/register.js";

export { registerExampleSandbox } from "./sandbox/register.js";
export type { RegisterExampleSandboxOptions } from "./sandbox/register.js";

export { registerProfile, unregisterProfile, deriveProfile, getProfile, listProfiles } from "./policy/registry.js";
export type { DeriveProfileOverrides } from "./policy/registry.js";
export type { ProfileDefinition, CustomElementAllowlistEntry } from "./policy/profile.js";
export { RESERVED_CUSTOM_ELEMENT_NAMES, isValidCustomElementName } from "./policy/profile.js";

export { sanitizeToFragment, sanitizeToFragmentSync } from "./sanitize/public.js";
export type { SanitizeToFragmentOptions, SanitizeToFragmentResult } from "./sanitize/public.js";

export { SafeFragmentError, isSafeFragmentError } from "./errors.js";
export type { SafeFragmentErrorCode } from "./errors.js";

export type {
  RenderMode,
  RenderScope,
  IdPolicy,
  SanitizerEngineKind,
  SanitizationNote,
  SanitizationReport,
  BeforeRenderDetail,
  RenderDetail,
  RejectDetail,
  ActionDetail,
  LinkDetail,
  ClearDetail,
  RenderResult,
  SourceKind,
} from "./types.js";

export { preloadSanitizer } from "./sanitize/preload.js";
export type { PreloadSanitizerOptions } from "./sanitize/preload.js";
export type { DOMPurifyFactory, DOMPurifyLoader, DOMPurifyLike } from "./sanitize/dompurify.js";

export { checkUrl, SAFE_DEFAULT_URL_SCHEMES, RELATIVE_URL_SCHEME } from "./policy/url.js";
export type { UrlCheckResult } from "./policy/url.js";
export type { CidResolver } from "./policy/cid.js";

export type { FetchCapability } from "./source/fetch.js";
export { DEFAULT_FETCH_CAPABILITY } from "./source/fetch.js";

// Built-in profile NAMES, as constants (autocomplete and typo protection).
// These are strings, not profile definitions: read a definition with
// `getProfile(ARTICLE_V1)`. Built-ins are frozen and cannot be modified.
export const PLAIN_TEXT_V1 = "plain-text-v1";
export const ARTICLE_V1 = "article-v1";
export const UI_V1 = "ui-v1";
export const EMAIL_V1 = "email-v1";
export const COMPONENT_TEMPLATE_V1 = "component-template-v1";
export type BuiltInProfileName = typeof PLAIN_TEXT_V1 | typeof ARTICLE_V1 | typeof UI_V1 | typeof EMAIL_V1 | typeof COMPONENT_TEMPLATE_V1;
