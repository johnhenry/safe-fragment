import type {
  RenderMode,
  RenderScope,
  IdPolicy,
  RenderResult,
  SourceKind,
  BeforeRenderDetail,
  RenderDetail,
  RejectDetail,
  ActionDetail,
  LinkDetail,
  ClearDetail,
} from "../types.js";

/** `addEventListener` event map for `<safe-fragment>`: typed `detail` for every event the element emits. */
export interface SafeFragmentEventMap {
  "safe-fragment:before-render": CustomEvent<BeforeRenderDetail>;
  "safe-fragment:render": CustomEvent<RenderDetail>;
  "safe-fragment:reject": CustomEvent<RejectDetail>;
  "safe-fragment:action": CustomEvent<ActionDetail>;
  "safe-fragment:link": CustomEvent<LinkDetail>;
  "safe-fragment:clear": CustomEvent<ClearDetail>;
  "safe-fragment:disabled": CustomEvent<null>;
}

/** The public surface of a `<safe-fragment>` element. */
export interface SafeFragmentElement extends HTMLElement {
  /** HTML-like markup source. `undefined` behaves like `null`; a non-string is rejected with `INVALID_SOURCE` at render time. */
  html: string | null;
  /** Reflects the `src` attribute. Requires the fetch capability. */
  source: string | null;
  /** Reflects `profile` (a registered profile name). Required; there is no default. */
  profile: string;
  /** Reflects `render-mode` (case-insensitive). */
  renderMode: RenderMode;
  /** Reflects `scope` (case-insensitive). Shadow DOM is not a security boundary. */
  scope: RenderScope;
  /** Reflects `id-policy`. `"keep-in-shadow"` leaves author ids as written and is honored only with `scope="shadow"` (else the render rejects with `INVALID_OPTION`); default `"prefix"`. */
  idPolicy: IdPolicy;
  /** Reflects `loading` (case-insensitive). `lazy` defers a `src` fetch until the element is near the viewport. */
  loading: "eager" | "lazy";
  disabled: boolean;
  debug: boolean;
  strict: boolean;
  /** Which markup source `render()` would use right now. */
  readonly sourceKind: SourceKind | "none" | "ambiguous";
  render(): Promise<RenderResult>;
  /** Alias of `render()`. */
  refresh(): Promise<RenderResult>;
  clear(): void;
  /** The wrapper element holding the rendered content, or `null` before the first render. */
  getRenderedRoot(): Element | null;

  addEventListener<K extends keyof SafeFragmentEventMap>(
    type: K,
    listener: (this: SafeFragmentElement, ev: SafeFragmentEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof SafeFragmentEventMap>(
    type: K,
    listener: (this: SafeFragmentElement, ev: SafeFragmentEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "safe-fragment": SafeFragmentElement;
  }
}
