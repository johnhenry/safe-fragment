import { SafeFragmentError, isSafeFragmentError, type SafeFragmentErrorCode } from "../errors.js";
import type { RenderMode, RenderScope, BeforeRenderDetail, RejectDetail, RenderResult, SourceKind, ClearDetail } from "../types.js";
import type { SafeFragmentElement } from "./element-types.js";
import { getProfile } from "../policy/registry.js";
import { sanitize, DEFAULT_MAX_INPUT_LENGTH } from "../sanitize/index.js";
import { fetchSource, ABORT_SUPERSEDED, type FetchCapability, DEFAULT_FETCH_CAPABILITY } from "../source/fetch.js";

const RENDERED_ROOT_MARKER = "data-safe-fragment-root";

/** Properties a framework or script may have set on the element BEFORE it was upgraded; re-applied through the setters on first connect. */
const UPGRADABLE_PROPERTIES = ["html", "source", "profile", "renderMode", "disabled", "scope", "loading", "strict", "debug"] as const;

export interface SafeFragmentElementDeps {
  fetchCapability: FetchCapability;
  /** Longest source (UTF-16 code units) accepted from `.html`/`<template>`/`content`/fetched text. */
  maxInputLength?: number;
}

type ResolvedSource = { kind: SourceKind; value: unknown } | { kind: "none" } | { kind: "ambiguous" };

interface LastRender {
  kind: SourceKind;
  value: unknown;
  profile: string;
  scope: RenderScope;
}

/** Enumerated attribute values are matched case-insensitively (HTML convention). */
function enumValue<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  if (raw === null) return fallback;
  const lower = raw.trim().toLowerCase();
  return (allowed as readonly string[]).includes(lower) ? (lower as T) : fallback;
}

/**
 * Builds the `<safe-fragment>` element class. A factory, not a top-level
 * `class ... extends HTMLElement`, so this module never touches
 * `HTMLElement` until `registerSafeFragment()` calls it with a real base
 * class from a real DOM environment.
 */
export function createSafeFragmentElementClass(
  HTMLElementBase: typeof HTMLElement,
  deps: SafeFragmentElementDeps,
): { new (): SafeFragmentElement; observedAttributes: string[] } {
  const maxInputLength = deps.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;

  class SafeFragmentElementImpl extends HTMLElementBase {
    static get observedAttributes(): string[] {
      return ["profile", "src", "render-mode", "scope", "content", "disabled", "strict", "loading"];
    }

    #htmlProperty: unknown = null;
    #scheduled = false;
    #scheduleEpoch = 0;
    #renderToken = 0;
    #hasRenderedOnce = false;
    #root: Element | null = null;
    #shadow: ShadowRoot | null = null;
    #rootScope: RenderScope | null = null;
    #delegationAttached = false;
    #abortController: AbortController | null = null;
    #intersectionObserver: IntersectionObserver | undefined;
    #lazyReady = false;
    #lastRender: LastRender | null = null;
    #upgraded = false;
    #watchedWindow: Window | null = null;
    #hostObserver: MutationObserver | undefined;
    #templateObserver: MutationObserver | undefined;
    #observedTemplate: HTMLTemplateElement | null = null;

    // ---- Lifecycle -------------------------------------------------------

    connectedCallback(): void {
      this.#upgradeProperties();
      this.#watchWindow();
      this.#observeTemplateSource();
      if (this.disabled) return;
      if (this.renderMode === "manual") return;
      // Moved within the DOM (or re-attached) with nothing relevant changed:
      // the rendered content is still there and still right. Do not refetch
      // or re-render.
      if (this.#isUpToDate()) return;
      this.#scheduleRender();
    }

    disconnectedCallback(): void {
      this.#teardownInFlight();
      // A lazy element cut off before it finished rendering must go back
      // through the gate when it is reconnected (its observer is gone and
      // its fetch was aborted); a completed render keeps its state.
      if (!this.#lastRender) this.#lazyReady = false;
      this.#unwatchWindow();
      this.#hostObserver?.disconnect();
      this.#hostObserver = undefined;
      this.#templateObserver?.disconnect();
      this.#templateObserver = undefined;
      this.#observedTemplate = null;
    }

    /**
     * Fired when the element moves to another document (e.g. a popout
     * window). The disconnected/connected pair around it has already torn
     * down and will re-arm everything against the new window; this only
     * makes sure nothing keeps pointing at the old one.
     */
    adoptedCallback(): void {
      this.#teardownInFlight();
      this.#unwatchWindow();
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
      if (oldValue === newValue) return;

      if (name === "disabled") {
        if (this.disabled) this.#disable();
        else if (this.isConnected) this.#scheduleRender();
        return;
      }

      if (name === "scope") {
        // The stale wrapper (light child or shadow wrapper) must not linger
        // under the old scope.
        this.#removeStaleRoot();
      }

      if (name === "src") {
        // New URL = new content: it goes back through the lazy gate.
        this.#lazyReady = false;
        this.#intersectionObserver?.disconnect();
        this.#intersectionObserver = undefined;
      }

      if (name === "loading" && this.loading === "eager") {
        this.#intersectionObserver?.disconnect();
        this.#intersectionObserver = undefined;
      }

      if (this.renderMode === "manual") return;
      this.#scheduleRender();
    }

    // ---- Properties -------------------------------------------------------

    get html(): string | null {
      return this.#htmlProperty as string | null;
    }
    /** `undefined` behaves like `null` (no html source). A non-string value is stored and rejected with `INVALID_SOURCE` at render time. */
    set html(value: string | null | undefined) {
      this.#htmlProperty = value === undefined ? null : value;
      this.#scheduleRender();
    }

    get source(): string | null {
      return this.getAttribute("src");
    }
    set source(value: string | null) {
      if (value === null) this.removeAttribute("src");
      else this.setAttribute("src", value);
    }

    get profile(): string {
      return this.getAttribute("profile") ?? "";
    }
    set profile(value: string) {
      this.setAttribute("profile", value);
    }

    get renderMode(): RenderMode {
      return enumValue(this.getAttribute("render-mode"), ["replace", "once", "manual"] as const, "replace");
    }
    set renderMode(value: RenderMode) {
      this.setAttribute("render-mode", value);
    }

    get scope(): RenderScope {
      return enumValue(this.getAttribute("scope"), ["light", "shadow"] as const, "light");
    }
    set scope(value: RenderScope) {
      this.setAttribute("scope", value);
    }

    get loading(): "eager" | "lazy" {
      return enumValue(this.getAttribute("loading"), ["eager", "lazy"] as const, "eager");
    }
    set loading(value: "eager" | "lazy") {
      this.setAttribute("loading", value);
    }

    get disabled(): boolean {
      return this.hasAttribute("disabled");
    }
    set disabled(value: boolean) {
      this.toggleAttribute("disabled", Boolean(value));
    }

    get debug(): boolean {
      return this.hasAttribute("debug");
    }
    set debug(value: boolean) {
      this.toggleAttribute("debug", Boolean(value));
    }

    get strict(): boolean {
      return this.hasAttribute("strict");
    }
    set strict(value: boolean) {
      this.toggleAttribute("strict", Boolean(value));
    }

    /** Which markup source `render()` would use right now (read-only). */
    get sourceKind(): SourceKind | "none" | "ambiguous" {
      return this.#resolveSource().kind;
    }

    // ---- Public methods ----------------------------------------------------

    /** Empties the rendered content and cancels any in-flight render; nothing already started can land afterwards. */
    clear(): void {
      this.#renderToken++;
      this.#abortController?.abort();
      this.#clearContent("clear", true);
    }

    /** Alias of `render()` (kept because "refresh" reads better at call sites that re-fetch a `src`). Identical behavior, including in `render-mode="once"`. */
    refresh(): Promise<RenderResult> {
      return this.render();
    }

    getRenderedRoot(): Element | null {
      return this.#root;
    }

    /**
     * Renders now, bypassing `render-mode` scheduling. Resolves (never
     * rejects) with a result object:
     *
     * - `rendered`   -- the sanitized fragment is in the DOM; `report` is set.
     * - `rejected`   -- nothing was rendered; `error` says why (a
     *   `safe-fragment:reject` event fired too). Unless the cause was a
     *   `before-render` veto, previously rendered content was CLEARED, so
     *   content never stays on screen under a profile/source the element no
     *   longer claims.
     * - `superseded` -- a newer `render()`, `clear()`, disable or disconnect
     *   overtook this one; `error` carries `FETCH_SUPERSEDED`/`FETCH_ABORTED`
     *   when a fetch was cut short. No event fires.
     * - `disabled`   -- the element is disabled; `error.code` is `DISABLED`.
     */
    async render(): Promise<RenderResult> {
      // An explicit render supersedes any automatic one already queued.
      this.#scheduleEpoch++;
      if (this.disabled) {
        const error = new SafeFragmentError("DISABLED", "render() was called on a disabled element.");
        this.#dispatchReject(error);
        return { status: "disabled", error };
      }

      const token = ++this.#renderToken;
      this.#abortController?.abort(ABORT_SUPERSEDED);
      const controller = new AbortController();
      this.#abortController = controller;
      const stale = (): boolean => token !== this.#renderToken || this.disabled;

      const resolved = this.#resolveSource();
      if (resolved.kind === "ambiguous") {
        return this.#rejectRender(
          new SafeFragmentError(
            "AMBIGUOUS_SOURCE",
            "More than one markup source (html property, <template> child, src, content attribute) was provided while strict mode is enabled.",
          ),
        );
      }
      if (resolved.kind === "none") {
        return this.#rejectRender(
          new SafeFragmentError(
            "NO_SOURCE",
            "No markup source was found: set the .html property, add a <template> child, set src, or (legacy) the content attribute.",
          ),
        );
      }
      if (resolved.kind !== "src" && typeof resolved.value !== "string") {
        return this.#rejectRender(
          new SafeFragmentError("INVALID_SOURCE", `The markup source must be a string, got ${resolved.value === null ? "null" : typeof resolved.value}.`, {
            details: { sourceKind: resolved.kind },
          }),
        );
      }

      const profileName = this.profile;
      if (profileName === "") {
        return this.#rejectRender(new SafeFragmentError("UNKNOWN_PROFILE", "The profile attribute/property is required and was not set."));
      }
      const profileDef = getProfile(profileName);
      if (!profileDef) {
        return this.#rejectRender(new SafeFragmentError("UNKNOWN_PROFILE", `Unknown profile "${profileName}".`, { details: { profile: profileName } }));
      }

      // `before-render` fires exactly here: after the source and profile
      // validated, before any fetch or parse. Invalid configurations reject
      // without it; a cancelled event vetoes the render and leaves existing
      // content alone.
      const beforeDetail: BeforeRenderDetail = { profile: profileName, sourceKind: resolved.kind };
      const allowed = this.dispatchEvent(new CustomEvent("safe-fragment:before-render", { detail: beforeDetail, cancelable: true, bubbles: true }));
      if (!allowed) {
        const error = new SafeFragmentError("RENDER_ABORTED", "A safe-fragment:before-render listener cancelled this render.");
        this.#dispatchReject(error);
        return { status: "rejected", error };
      }
      if (stale()) return this.#supersededResult();

      if (resolved.kind === "content-attribute") {
        console.warn('safe-fragment: the "content" attribute is a legacy fallback (lowest precedence). Prefer the .html property, a <template> child, or src.');
      }

      const scope = this.scope;
      let rawHtml: string;
      try {
        rawHtml =
          resolved.kind === "src"
            ? await fetchSource(this.ownerDocument, resolved.value as string, deps.fetchCapability, controller.signal)
            : (resolved.value as string);
      } catch (error) {
        if (stale()) return this.#supersededResult(isSafeFragmentError(error) ? error : undefined);
        if (isSafeFragmentError(error) && (error.code === "FETCH_SUPERSEDED" || error.code === "FETCH_ABORTED")) {
          return { status: "superseded", error };
        }
        return this.#rejectRender(error);
      }
      if (stale()) return this.#supersededResult();

      let sanitizeResult;
      try {
        sanitizeResult = await sanitize(this.ownerDocument, rawHtml, profileDef, { truncated: false, maxInputLength });
      } catch (error) {
        if (stale()) return this.#supersededResult();
        return this.#rejectRender(error);
      }
      if (stale()) return this.#supersededResult();

      const root = this.#ensureRoot();
      root.replaceChildren(sanitizeResult.fragment);
      this.#hasRenderedOnce = true;
      this.#root = root;
      this.#lastRender = { kind: resolved.kind, value: resolved.value, profile: profileName, scope };

      this.#attachDelegationOnce();

      this.dispatchEvent(
        new CustomEvent("safe-fragment:render", {
          detail: { report: sanitizeResult.report, root },
          bubbles: true,
        }),
      );
      return { status: "rendered", report: sanitizeResult.report };
    }

    // ---- Internal ------------------------------------------------------------

    #upgradeProperties(): void {
      if (this.#upgraded) return;
      this.#upgraded = true;
      // A property assigned before this element was upgraded shadows the
      // class accessor as an own data property; the standard fix is to
      // delete it and replay the value through the real setter.
      for (const prop of UPGRADABLE_PROPERTIES) {
        if (Object.prototype.hasOwnProperty.call(this, prop)) {
          const value = (this as unknown as Record<string, unknown>)[prop];
          delete (this as unknown as Record<string, unknown>)[prop];
          (this as unknown as Record<string, unknown>)[prop] = value;
        }
      }
    }

    #watchWindow(): void {
      const win = this.ownerDocument.defaultView;
      if (!win || win === this.#watchedWindow) return;
      this.#unwatchWindow();
      // Removing an <iframe> does not run disconnectedCallback for elements
      // inside it; its window's `pagehide` is the reliable signal to stop
      // fetching and observing for a document that is going away.
      win.addEventListener("pagehide", this.#onPageHide);
      this.#watchedWindow = win;
    }

    #unwatchWindow(): void {
      this.#watchedWindow?.removeEventListener("pagehide", this.#onPageHide);
      this.#watchedWindow = null;
    }

    #onPageHide = (): void => {
      this.#teardownInFlight();
    };

    #teardownInFlight(): void {
      this.#abortController?.abort();
      this.#intersectionObserver?.disconnect();
      this.#intersectionObserver = undefined;
    }

    #disable(): void {
      this.#renderToken++;
      this.#abortController?.abort();
      this.#intersectionObserver?.disconnect();
      this.#intersectionObserver = undefined;
      this.#clearContent("disabled", false);
      this.dispatchEvent(new CustomEvent("safe-fragment:disabled", { bubbles: true }));
    }

    #supersededResult(error?: SafeFragmentError): RenderResult {
      return error ? { status: "superseded", error } : { status: "superseded" };
    }

    #resolveSource(): ResolvedSource {
      const hasHtmlProp = this.#htmlProperty !== null;
      const templateChild = this.#templateChild();
      const hasTemplate = templateChild !== null;
      const hasSrc = this.hasAttribute("src");
      const hasContent = this.hasAttribute("content");

      if (this.strict) {
        const count = [hasHtmlProp, hasTemplate, hasSrc, hasContent].filter(Boolean).length;
        if (count > 1) return { kind: "ambiguous" };
      }

      if (hasHtmlProp) return { kind: "html-property", value: this.#htmlProperty };
      if (templateChild) return { kind: "template-child", value: templateChild.innerHTML };
      if (hasSrc) return { kind: "src", value: this.getAttribute("src") as string };
      if (hasContent) return { kind: "content-attribute", value: this.getAttribute("content") as string };
      return { kind: "none" };
    }

    #templateChild(): HTMLTemplateElement | null {
      return this.querySelector<HTMLTemplateElement>(":scope > template");
    }

    /** True when what is on screen already corresponds to the current source, profile and scope. */
    #isUpToDate(): boolean {
      const last = this.#lastRender;
      if (!last || !this.#root) return false;
      const resolved = this.#resolveSource();
      if (resolved.kind === "none" || resolved.kind === "ambiguous") return false;
      return resolved.kind === last.kind && resolved.value === last.value && this.profile === last.profile && this.scope === last.scope;
    }

    /**
     * Edits to a `<template>` source child are observed (its content, and the
     * template being added/removed/replaced), so a template-sourced element
     * re-renders when its source changes -- subject to `render-mode` like any
     * other automatic trigger.
     */
    #observeTemplateSource(): void {
      const MO =
        (this.ownerDocument.defaultView as (Window & { MutationObserver?: typeof MutationObserver }) | null)?.MutationObserver ?? globalThis.MutationObserver;
      if (!MO) return;
      if (!this.#hostObserver) {
        this.#hostObserver = new MO((records) => {
          const touchesTemplate = records.some((r) =>
            [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1 && (n as Element).localName === "template"),
          );
          if (!touchesTemplate) return;
          this.#syncTemplateObserver(MO);
          this.#scheduleRender();
        });
        this.#hostObserver.observe(this, { childList: true });
      }
      this.#syncTemplateObserver(MO);
    }

    #syncTemplateObserver(MO: typeof MutationObserver): void {
      const tpl = this.#templateChild();
      if (tpl === this.#observedTemplate) return;
      this.#templateObserver?.disconnect();
      this.#observedTemplate = tpl;
      if (!tpl) return;
      this.#templateObserver ??= new MO(() => this.#scheduleRender());
      this.#templateObserver.observe(tpl.content, { childList: true, subtree: true, characterData: true, attributes: true });
    }

    #ensureRoot(): Element {
      const scope = this.scope;
      if (this.#rootScope !== null && this.#rootScope !== scope) this.#removeStaleRoot();
      this.#rootScope = scope;

      if (scope === "shadow") {
        if (!this.#shadow) {
          this.#shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        }
        let wrapper = this.#shadow.querySelector(`[${RENDERED_ROOT_MARKER}]`);
        if (!wrapper) {
          wrapper = this.ownerDocument.createElement("div");
          wrapper.setAttribute(RENDERED_ROOT_MARKER, "");
          wrapper.setAttribute("part", "content");
          this.#shadow.appendChild(wrapper);
        }
        return wrapper;
      }
      // Light DOM: use a dedicated child element rather than the host
      // itself, so a <template> source child (or other host children) is
      // never destroyed by clearing/re-rendering the output.
      let wrapper = this.querySelector(`:scope > [${RENDERED_ROOT_MARKER}]`);
      if (!wrapper) {
        wrapper = this.ownerDocument.createElement("div");
        wrapper.setAttribute(RENDERED_ROOT_MARKER, "");
        wrapper.setAttribute("part", "content");
        this.appendChild(wrapper);
      }
      return wrapper;
    }

    /** Removes the rendered wrapper of the scope we are leaving (a shadow root itself cannot be detached, so its wrapper is emptied and removed). */
    #removeStaleRoot(): void {
      this.#shadow?.querySelector(`[${RENDERED_ROOT_MARKER}]`)?.remove();
      this.querySelector(`:scope > [${RENDERED_ROOT_MARKER}]`)?.remove();
      this.#root = null;
      this.#rootScope = null;
      this.#lastRender = null;
      this.#hasRenderedOnce = false;
    }

    /** Empties the rendered content and forgets that anything was rendered (so `once` mode may render again). */
    #clearContent(reason: ClearDetail["reason"], always: boolean): void {
      const had = this.#root !== null && this.#root.firstChild !== null;
      this.#root?.replaceChildren();
      this.#lastRender = null;
      this.#hasRenderedOnce = false;
      if (had || always) {
        this.dispatchEvent(new CustomEvent<ClearDetail>("safe-fragment:clear", { detail: { reason }, bubbles: true }));
      }
    }

    /**
     * Schedules an automatic (microtask-coalesced) render. Automatic
     * triggers -- `connectedCallback`, `attributeChangedCallback`, the
     * `.html` setter, template mutations -- all funnel through here, so
     * "once" mode's "ignore subsequent changes" rule and the lazy gate live
     * in exactly one place. Explicit `render()`/`refresh()` calls bypass this
     * method entirely, which is what lets `refresh()` re-render on demand
     * even in "once" mode. "manual" mode never auto-schedules at all.
     */
    #scheduleRender(): void {
      if (this.renderMode === "manual") return;
      if (this.renderMode === "once" && this.#hasRenderedOnce) return;
      if (this.#scheduled) return;
      this.#scheduled = true;
      const epoch = this.#scheduleEpoch;
      queueMicrotask(() => {
        this.#scheduled = false;
        if (epoch !== this.#scheduleEpoch) return; // render() was called explicitly in the meantime
        // Re-check mode/disabled/connected here, not just at scheduling
        // time: this callback can run after connectedCallback queued it but
        // before render-mode/profile attributes were set imperatively (a
        // common pattern: create(), append(), *then* configure) -- without
        // this recheck a mode that became "manual" in between would still
        // auto-render once.
        if (this.renderMode === "manual") return;
        if (this.renderMode === "once" && this.#hasRenderedOnce) return;
        if (!this.isConnected || this.disabled) return;
        if (this.#lazyBlocked()) {
          this.#armLazyLoading();
          return;
        }
        void this.render();
      });
    }

    /** True while a `loading="lazy"` `src` element has not yet scrolled into view. */
    #lazyBlocked(): boolean {
      return this.loading === "lazy" && this.#resolveSource().kind === "src" && !this.#lazyReady;
    }

    #armLazyLoading(): void {
      if (this.#intersectionObserver) return;
      const IO = (this.ownerDocument.defaultView as (Window & { IntersectionObserver?: typeof IntersectionObserver }) | null)?.IntersectionObserver;
      if (!IO) {
        // No IntersectionObserver: degrade to eager rather than never loading.
        this.#lazyReady = true;
        this.#scheduleRender();
        return;
      }
      this.#intersectionObserver = new IO((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.#lazyReady = true;
        this.#intersectionObserver?.disconnect();
        this.#intersectionObserver = undefined;
        this.#scheduleRender();
      });
      this.#intersectionObserver.observe(this);
    }

    #attachDelegationOnce(): void {
      if (this.#delegationAttached) return;
      this.#delegationAttached = true;
      this.addEventListener("click", (event: Event) => {
        // composedPath() sees through shadow boundaries; with scope="shadow"
        // `event.target` is retargeted to the host and `closest()` would find
        // nothing. Only elements inside OUR rendered root count.
        const root = this.#root;
        if (!root) return;
        const path = event.composedPath();
        // nodeType, not `instanceof Element`: the element may live in an iframe/popout realm.
        const isElement = (n: EventTarget): n is Element => (n as Node).nodeType === 1;
        const inRoot = (el: Element): boolean => root.contains(el);

        const actionEl = path.find((n): n is HTMLElement => isElement(n) && n.hasAttribute("data-action") && inRoot(n));
        if (actionEl) {
          const action = actionEl.getAttribute("data-action") ?? "";
          this.dispatchEvent(
            new CustomEvent("safe-fragment:action", {
              detail: { action, element: actionEl, originalEvent: event },
              bubbles: true,
            }),
          );
        }

        const linkEl = path.find((n): n is HTMLAnchorElement => isElement(n) && n.localName === "a" && n.hasAttribute("href") && inRoot(n));
        if (linkEl) {
          this.dispatchEvent(
            new CustomEvent("safe-fragment:link", {
              detail: { href: linkEl.href, target: linkEl.getAttribute("target"), element: linkEl, originalEvent: event },
              bubbles: true,
            }),
          );
        }
      });
    }

    /** A failed render: clear what was on screen, announce the failure, report it. */
    #rejectRender(error: unknown): RenderResult {
      const typed = this.#toError(error);
      this.#clearContent("rejected", false);
      this.#dispatchReject(typed);
      return { status: "rejected", error: typed };
    }

    #toError(error: unknown): SafeFragmentError {
      if (isSafeFragmentError(error)) return error;
      return new SafeFragmentError("SANITIZE_FAILED" satisfies SafeFragmentErrorCode, error instanceof Error ? error.message : String(error), { cause: error });
    }

    #dispatchReject(error: SafeFragmentError): void {
      const detail: RejectDetail = { code: error.code, message: error.message, details: error.details };
      if (this.debug) {
        console.warn("safe-fragment reject:", detail.code, detail.message);
      }
      this.dispatchEvent(new CustomEvent("safe-fragment:reject", { detail, bubbles: true }));
    }
  }

  return SafeFragmentElementImpl as unknown as { new (): SafeFragmentElement; observedAttributes: string[] };
}

export const DEFAULT_DEPS: SafeFragmentElementDeps = { fetchCapability: DEFAULT_FETCH_CAPABILITY };
