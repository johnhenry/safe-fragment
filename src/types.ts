import type { SafeFragmentError, SafeFragmentErrorCode } from "./errors.js";

/** How `<safe-fragment>` schedules re-renders. */
export type RenderMode = "replace" | "once" | "manual";

/** Light DOM (default) vs an opt-in open shadow root. See docs/security-model.md -- Shadow DOM is NOT a security boundary. */
export type RenderScope = "light" | "shadow";

/** Which sanitization engine actually produced a given render. */
export type SanitizerEngineKind = "native" | "dompurify";

/**
 * One removed element or attribute, or one rewritten (nulled) URL, recorded
 * for `SanitizationReport`. Never carries the full original markup --
 * `snippet` is length-limited and exists only to help a developer locate
 * the offending content, not to reconstruct it.
 */
export interface SanitizationNote {
  /** Lowercase tag name the note applies to. */
  tag: string;
  /** Attribute name, if this note is attribute-scoped (absent for whole-element removal). */
  attribute?: string;
  /** Stable, human-readable reason, e.g. "element-not-in-profile", "disallowed-url-scheme". */
  reason: string;
  /** A short (<=80 char), truncated snippet of the offending value -- never the full source string. */
  snippet?: string;
}

/**
 * Structured summary of what a sanitization pass changed. Intentionally
 * never includes the full raw input or output HTML -- see
 * docs/security-model.md "What is logged" for the reasoning. Consumers that
 * want the actual sanitized markup should read it from the rendered DOM
 * (`getRenderedRoot()`), not from this report.
 */
export interface SanitizationReport {
  profile: string;
  engine: SanitizerEngineKind;
  removedElements: SanitizationNote[];
  removedAttributes: SanitizationNote[];
  rewrittenUrls: SanitizationNote[];
  /** Wall-clock time spent sanitizing, in milliseconds. */
  durationMs: number;
  /** Length (UTF-16 code units) of the raw input string. */
  inputLength: number;
  /** Length (UTF-16 code units) of the serialized sanitized output. */
  outputLength: number;
  /** True if the input was truncated before sanitization (e.g. `src` fetch size cap). */
  truncated: boolean;
}

/** Which markup source a render used (see the README's source precedence). */
export type SourceKind = "html-property" | "template-child" | "src" | "content-attribute";

/** What `render()`/`refresh()` resolved with. */
export interface RenderResult {
  status: "rendered" | "rejected" | "superseded" | "disabled";
  /** Set for `rejected`, `disabled`, and for a `superseded` render whose fetch was cut short (`FETCH_SUPERSEDED`/`FETCH_ABORTED`). */
  error?: SafeFragmentError;
  /** Set when `status` is `rendered`. */
  report?: SanitizationReport;
}

/** Detail payload of the `safe-fragment:clear` event. */
export interface ClearDetail {
  /** `clear`: `clear()` was called; `disabled`: the element was disabled; `rejected`: a render was rejected and the stale content removed. */
  reason: "clear" | "disabled" | "rejected";
}

/** Detail payload of the `safe-fragment:before-render` event. Cancelable -- calling `preventDefault()` aborts the render. */
export interface BeforeRenderDetail {
  profile: string;
  sourceKind: SourceKind;
}

/** Detail payload of the `safe-fragment:render` event. */
export interface RenderDetail {
  report: SanitizationReport;
  root: Node;
}

/** Detail payload of the `safe-fragment:reject` event. */
export interface RejectDetail {
  code: SafeFragmentErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Detail payload of the `safe-fragment:action` event (ui-v1's `data-action` delegation). */
export interface ActionDetail {
  action: string;
  element: Element;
  originalEvent: Event;
}

/** Detail payload of the `safe-fragment:link` event, dispatched before a rendered `<a>` navigates. Call `preventDefault()` on the underlying click to stop default navigation. */
export interface LinkDetail {
  href: string;
  target: string | null;
  element: HTMLAnchorElement;
  originalEvent: MouseEvent;
}
