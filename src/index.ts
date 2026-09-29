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

export { registerSafeFragment } from "./render/register.js";
export type { RegisterSafeFragmentOptions } from "./render/register.js";

export { registerExampleSandbox } from "./sandbox/register.js";
export type { RegisterExampleSandboxOptions } from "./sandbox/register.js";

export { defineProfile, getProfile, listProfiles } from "./policy/registry.js";
export type { DefineProfileOptions } from "./policy/registry.js";
export type { ProfileDefinition, CustomElementAllowlistEntry } from "./policy/profile.js";

export { SafeFragmentError, isSafeFragmentError } from "./errors.js";
export type { SafeFragmentErrorCode } from "./errors.js";

export type {
  RenderMode,
  RenderScope,
  SanitizerEngineKind,
  SanitizationNote,
  SanitizationReport,
  BeforeRenderDetail,
  RenderDetail,
  RejectDetail,
  ActionDetail,
  LinkDetail,
} from "./types.js";

export { checkUrl, SAFE_DEFAULT_URL_SCHEMES, RELATIVE_URL_SCHEME } from "./policy/url.js";
export type { UrlCheckResult } from "./policy/url.js";

export type { FetchCapability } from "./source/fetch.js";
export { DEFAULT_FETCH_CAPABILITY } from "./source/fetch.js";

// Built-in profile identifiers, exported as named constants so callers
// don't need to hand-type profile name strings (and get IDE
// autocomplete/typo protection).
export const PLAIN_TEXT_V1 = "plain-text-v1";
export const ARTICLE_V1 = "article-v1";
export const UI_V1 = "ui-v1";
export const EMAIL_V1 = "email-v1";
