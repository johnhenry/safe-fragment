import { SafeFragmentError, isSafeFragmentError, type SafeFragmentErrorCode } from "../errors.js";
import type { RenderMode, RenderScope, BeforeRenderDetail, RejectDetail } from "../types.js";
import { getProfile, getCustomElementAllowlist } from "../policy/registry.js";
import { sanitize } from "../sanitize/index.js";
import { fetchSource, ABORT_SUPERSEDED, type FetchCapability, DEFAULT_FETCH_CAPABILITY } from "../source/fetch.js";

const RENDERED_ROOT_MARKER = "data-safe-fragment-root";

type SourceKind = "html-property" | "template-child" | "src" | "content-attribute";

export interface SafeFragmentElementDeps {
  fetchCapability: FetchCapability;
}

/**
 * Builds the `<safe-fragment>` element class. A factory, not a top-level
 * `class ... extends HTMLElement`, so this module never touches
 * `HTMLElement` until `registerSafeFragment()` calls it with a real base
 * class from a real DOM environment.
 */
export function createSafeFragmentElementClass(HTMLElementBase: typeof HTMLElement, deps: SafeFragmentElementDeps) {
  return class SafeFragmentElement extends HTMLElementBase {
    static get observedAttributes(): string[] {
      return ["profile", "src", "render-mode", "scope", "content", "disabled", "strict", "loading"];
    }

    #htmlProperty: string | null = null;
    #scheduled = false;
    #renderToken = 0;
    #hasRenderedOnce = false;
    #root: Element | null = null;
    #shadow: ShadowRoot | null = null;
    #delegationAttached = false;
    #abortController: AbortController | null = null;
    #intersectionObserver: IntersectionObserver | undefined;
    #lazyReady = false;

    connectedCallback(): void {
      if (this.disabled) return;
      if (this.renderMode === "manual") return;
      if (this.sourceKindNow() === "src" && this.loading === "lazy") {
        this.#setUpLazyLoading();
        return;
      }
      this.#scheduleRender();
    }

    disconnectedCallback(): void {
      this.#abortController?.abort();
      this.#intersectionObserver?.disconnect();
      this.#intersectionObserver = undefined;
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
      if (oldValue === newValue) return;
      if (name === "disabled") {
        if (this.disabled) this.clear();
        else this.#scheduleRender();
        return;
      }
      if (this.renderMode === "manual") return;
      this.#scheduleRender();
    }

    // ---- Properties -------------------------------------------------

    get html(): string | null {
      return this.#htmlProperty;
    }
    set html(value: string | null) {
      this.#htmlProperty = value;
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
      const v = this.getAttribute("render-mode");
      return v === "once" || v === "manual" ? v : "replace";
    }
    set renderMode(value: RenderMode) {
      this.setAttribute("render-mode", value);
    }

    get scope(): RenderScope {
      return this.getAttribute("scope") === "shadow" ? "shadow" : "light";
    }

    get loading(): "eager" | "lazy" {
      return this.getAttribute("loading") === "lazy" ? "lazy" : "eager";
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

    get strict(): boolean {
      return this.hasAttribute("strict");
    }

    // ---- Public methods ----------------------------------------------

    clear(): void {
      this.#abortController?.abort();
      if (this.#root) {
        this.#root.replaceChildren();
      }
    }

    refresh(): Promise<void> {
      return this.render();
    }

    getRenderedRoot(): Node | null {
      return this.#root;
    }

    async render(): Promise<void> {
      if (this.disabled) return;

      const token = ++this.#renderToken;
      this.#abortController?.abort(ABORT_SUPERSEDED);
      const controller = new AbortController();
      this.#abortController = controller;

      const resolved = this.#resolveSource();
      if (resolved.kind === "ambiguous") {
        this.#reject(
          "AMBIGUOUS_SOURCE",
          "More than one markup source (html property, <template> child, src, content attribute) was provided while strict mode is enabled.",
        );
        return;
      }
      if (resolved.kind === "none") {
        this.#reject("NO_SOURCE", "No markup source was found: set the .html property, add a <template> child, set src, or (legacy) the content attribute.");
        return;
      }

      const profileName = this.profile;
      if (profileName === "") {
        this.#reject("UNKNOWN_PROFILE", "The profile attribute/property is required and was not set.");
        return;
      }
      const profileDef = getProfile(profileName);
      if (!profileDef) {
        this.#reject("UNKNOWN_PROFILE", `Unknown profile "${profileName}".`, { profile: profileName });
        return;
      }

      const beforeDetail: BeforeRenderDetail = { profile: profileName, sourceKind: resolved.kind };
      const allowed = this.dispatchEvent(new CustomEvent("safe-fragment:before-render", { detail: beforeDetail, cancelable: true, bubbles: true }));
      if (!allowed) return; // host explicitly vetoed this render

      if (resolved.kind === "content-attribute") {
        console.warn('safe-fragment: the "content" attribute is a legacy fallback (lowest precedence). Prefer the .html property, a <template> child, or src.');
      }

      let rawHtml: string;
      try {
        if (resolved.kind === "src") {
          rawHtml = await fetchSource(this.ownerDocument, resolved.value, deps.fetchCapability, controller.signal);
        } else {
          rawHtml = resolved.value;
        }
      } catch (error) {
        if (token !== this.#renderToken) return; // superseded; stay silent
        this.#rejectError(error);
        return;
      }
      if (token !== this.#renderToken) return;

      const customElements = getCustomElementAllowlist(profileName);

      let sanitizeResult;
      try {
        sanitizeResult = await sanitize(this.ownerDocument, rawHtml, profileDef, customElements, { truncated: false });
      } catch (error) {
        if (token !== this.#renderToken) return;
        this.#rejectError(error);
        return;
      }
      if (token !== this.#renderToken) return;

      const root = this.#ensureRoot();
      root.replaceChildren(sanitizeResult.fragment);
      this.#hasRenderedOnce = true;
      this.#root = root;

      this.#attachDelegationOnce();

      this.dispatchEvent(
        new CustomEvent("safe-fragment:render", {
          detail: { report: sanitizeResult.report, root },
          bubbles: true,
        }),
      );
    }

    // ---- Internal ------------------------------------------------------

    sourceKindNow(): SourceKind | "none" | "ambiguous" {
      const r = this.#resolveSource();
      return r.kind;
    }

    #resolveSource(): { kind: SourceKind; value: string } | { kind: "none" } | { kind: "ambiguous" } {
      const hasHtmlProp = this.#htmlProperty !== null;
      const templateChild = this.querySelector(":scope > template");
      const hasTemplate = templateChild !== null;
      const hasSrc = this.hasAttribute("src");
      const hasContent = this.hasAttribute("content");

      if (this.strict) {
        const count = [hasHtmlProp, hasTemplate, hasSrc, hasContent].filter(Boolean).length;
        if (count > 1) return { kind: "ambiguous" };
      }

      if (hasHtmlProp) return { kind: "html-property", value: this.#htmlProperty as string };
      if (hasTemplate) return { kind: "template-child", value: (templateChild as HTMLTemplateElement).innerHTML };
      if (hasSrc) return { kind: "src", value: this.getAttribute("src") as string };
      if (hasContent) return { kind: "content-attribute", value: this.getAttribute("content") as string };
      return { kind: "none" };
    }

    #ensureRoot(): Element {
      if (this.scope === "shadow") {
        if (!this.#shadow) {
          this.#shadow = this.attachShadow({ mode: "open" });
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

    /**
     * Schedules an automatic (microtask-coalesced) render. Automatic
     * triggers -- `connectedCallback`, `attributeChangedCallback`, the
     * `.html`/`.disabled` property setters -- all funnel through here, so
     * "once" mode's "ignore subsequent changes" rule lives in exactly one
     * place. Explicit `render()`/`refresh()` calls bypass this method
     * entirely (they call `render()` directly), which is what lets
     * `refresh()` re-render on demand even in "once" mode, per its
     * documented contract. "manual" mode never auto-schedules at all --
     * only an explicit `render()`/`refresh()` call renders anything.
     */
    #scheduleRender(): void {
      if (this.renderMode === "manual") return;
      if (this.renderMode === "once" && this.#hasRenderedOnce) return;
      if (this.#scheduled) return;
      this.#scheduled = true;
      queueMicrotask(() => {
        this.#scheduled = false;
        // Re-check renderMode here, not just at scheduling time: this
        // callback can run after connectedCallback queued it but before
        // render-mode/profile attributes were set imperatively (a common
        // pattern: create(), append(), *then* configure) -- without this
        // recheck a mode that became "manual" in between would still
        // auto-render once, silently violating "manual never auto-renders".
        if (this.renderMode === "manual") return;
        if (this.isConnected && !this.disabled) void this.render();
      });
    }

    #setUpLazyLoading(): void {
      const IO = (globalThis as unknown as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
      if (!IO) {
        this.#scheduleRender();
        return;
      }
      if (this.#lazyReady) return;
      this.#intersectionObserver = new IO((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.#lazyReady = true;
            this.#intersectionObserver?.disconnect();
            this.#scheduleRender();
          }
        }
      });
      this.#intersectionObserver.observe(this);
    }

    #attachDelegationOnce(): void {
      if (this.#delegationAttached) return;
      this.#delegationAttached = true;
      this.addEventListener("click", (event: Event) => {
        const target = event.target as Element | null;
        if (!target) return;

        const actionEl = target.closest<HTMLElement>("[data-action]");
        if (actionEl && this.contains(actionEl)) {
          const action = actionEl.getAttribute("data-action") ?? "";
          this.dispatchEvent(
            new CustomEvent("safe-fragment:action", {
              detail: { action, element: actionEl, originalEvent: event },
              bubbles: true,
            }),
          );
        }

        const linkEl = target.closest<HTMLAnchorElement>("a[href]");
        if (linkEl && this.contains(linkEl)) {
          this.dispatchEvent(
            new CustomEvent("safe-fragment:link", {
              detail: { href: linkEl.href, target: linkEl.getAttribute("target"), element: linkEl, originalEvent: event },
              bubbles: true,
            }),
          );
        }
      });
    }

    #reject(code: SafeFragmentErrorCode, message: string, details?: Record<string, unknown>): void {
      this.#rejectError(new SafeFragmentError(code, message, { details }));
    }

    #rejectError(error: unknown): void {
      const detail: RejectDetail = isSafeFragmentError(error)
        ? { code: error.code, message: error.message, details: error.details }
        : { code: "SANITIZE_FAILED", message: error instanceof Error ? error.message : String(error) };
      if (this.debug) {
        console.warn("safe-fragment reject:", detail.code, detail.message);
      }
      this.dispatchEvent(new CustomEvent("safe-fragment:reject", { detail, bubbles: true }));
    }
  };
}

export const DEFAULT_DEPS: SafeFragmentElementDeps = { fetchCapability: DEFAULT_FETCH_CAPABILITY };
