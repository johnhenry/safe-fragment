/**
 * The parse realm: where the sanitizer engines parse untrusted markup (ADR 0012, ADR 0013, safe-fragment#13).
 *
 * The default realm is an inert document made by `document.implementation.createHTMLDocument()`: no browsing
 * context, so nothing loads or runs. In Chromium that document still shares the page's execution context, and
 * Chromium's HTML parser checks that context's Content-Security-Policy while it parses: a `style=` attribute reports
 * `style-src-attr`, and (for the DOMPurify engine's `DOMParser` document) `<style>`/`<base>` report
 * `style-src-elem`/`base-uri`, although the output is clean and nothing is applied. Every document whose context
 * has a policy reports, and a same-origin `about:blank` iframe inherits the page's policy (report endpoints
 * included), so an iframe that stays attached only moves the reports to its own document (ADR 0013).
 *
 * What does not report is a document whose context is gone: one made from the `DOMImplementation` (or the
 * `DOMParser`) of an iframe that has been removed from the page. So, on Chromium, the realm is a same-origin
 * `about:blank` iframe that is appended to `<html>` only for as long as it takes to capture its window (and to
 * create anything that needs a live window, such as DOMPurify and its Trusted Types policy: `prepare`), then removed
 * at once. The native engine builds its inert documents from that detached window's `DOMImplementation`, DOMPurify
 * runs on that detached window. Untrusted markup is still only ever parsed into documents that have no browsing
 * context; nothing is left in the page. Everything falls back to the default realm when an iframe cannot be created
 * or reached (a sandboxed page, no `<html>` yet), so this can only remove noise.
 *
 * `"auto"` (the default) uses the iframe only on Chromium-based engines, the only ones that report. They are
 * recognized by `navigator.userAgentData`, which only Chromium defines; Firefox and Safari keep the default realm.
 * `"iframe"` forces the iframe elsewhere too, but there it stays attached: WebKit's Trusted Types policies stop
 * working once their window is detached (measured), and nothing reports there to begin with.
 */
import { getSharedState } from "../shared-state.js";

export type InertRealmMode = "auto" | "iframe" | "document";

export interface InertRealm {
  /** The realm iframe's window: where DOMPurify is created. Detached (no longer in any page) on Chromium. */
  readonly window: Window;
  /** The realm iframe's `DOMImplementation`: what the native engine creates its inert documents from. */
  readonly implementation: DOMImplementation;
}

/** Runs on the realm's window while its iframe is still attached (e.g. creating DOMPurify), before it is detached. */
export type RealmPreparer = (win: Window) => void;

function isChromiumLike(doc: Document): boolean {
  const nav = doc.defaultView?.navigator as (Navigator & { userAgentData?: unknown }) | undefined;
  return nav !== undefined && nav.userAgentData !== undefined;
}

function usesIframe(doc: Document, mode: InertRealmMode): boolean {
  return mode === "iframe" || (mode === "auto" && isChromiumLike(doc));
}

interface RealmRecord {
  frame: HTMLIFrameElement;
  realm: InertRealm;
  /** Removed from the page right after it was made (Chromium); otherwise it stays attached. */
  detached: boolean;
}

function realmStore(): WeakMap<object, RealmRecord | null> {
  return (getSharedState().realms ??= new WeakMap());
}

/** The cached realm for `doc` if there is a usable one; never creates one. `null`: none can be made for `doc`. */
function cachedRealm(doc: Document): RealmRecord | null | undefined {
  const realms = realmStore();
  const known = realms.get(doc);
  if (known === undefined || known === null) return known;
  // A detached realm stays usable; an attached one (non-Chromium "iframe") is gone if the host removed its iframe.
  if (known.detached || (known.frame.isConnected && known.frame.contentWindow && known.frame.contentDocument)) return known;
  realms.delete(doc); // the host removed it: make another
  return undefined;
}

/** Whether `doc` parses in an iframe realm under `mode` (`false` also when none can be made for `doc`). */
export function inertRealmApplies(doc: Document, mode: InertRealmMode = "auto"): boolean {
  return usesIframe(doc, mode) && cachedRealm(doc) !== null;
}

/** The existing inert realm for `doc` (without creating one), or `undefined`. */
export function peekInertRealm(doc: Document, mode: InertRealmMode = "auto"): InertRealm | undefined {
  if (!usesIframe(doc, mode)) return undefined;
  return cachedRealm(doc)?.realm;
}

/** A new realm iframe in `doc`, attached; `undefined` when `doc` is not ready yet, `null` when none can be made. */
function createFrame(doc: Document): { frame: HTMLIFrameElement; realm: InertRealm } | null | undefined {
  let frame: HTMLIFrameElement | undefined;
  try {
    const host = doc.documentElement;
    if (!host || !doc.defaultView) return undefined;
    frame = doc.createElement("iframe");
    frame.setAttribute("hidden", "");
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("title", "");
    frame.setAttribute("data-safe-fragment-realm", "");
    host.appendChild(frame);
    const inner = frame.contentWindow;
    const innerDoc = frame.contentDocument;
    if (!inner || !innerDoc) {
      frame.remove();
      return null;
    }
    return { frame, realm: { window: inner, implementation: innerDoc.implementation } };
  } catch {
    frame?.remove();
    return null;
  }
}

/**
 * The inert realm for `doc`, or `undefined` to use the default one (`doc.implementation`, `doc.defaultView`).
 *
 * With `prepare`, the returned realm's window has had `prepare` run on it while its iframe was attached: the cached
 * realm if its iframe is still attached, otherwise a new realm, which then replaces the cached one. When no realm
 * can be prepared, `undefined` is returned and `prepare` is not called. Errors `prepare` throws propagate (the new
 * iframe is removed first, and the cached realm is kept).
 */
export function getInertRealm(doc: Document, mode: InertRealmMode = "auto", prepare?: RealmPreparer): InertRealm | undefined {
  if (!usesIframe(doc, mode)) return undefined;
  const realms = realmStore();
  const known = cachedRealm(doc);
  if (known === null) return undefined;
  if (known !== undefined) {
    if (!prepare) return known.realm;
    if (!known.detached) {
      prepare(known.realm.window);
      return known.realm;
    }
  }
  const fallback = prepare ? undefined : known?.realm;
  const created = createFrame(doc);
  if (created === undefined) return fallback; // not ready yet: nothing cached, try again next time
  if (created === null) {
    if (!known) realms.set(doc, null);
    return fallback;
  }
  const { frame, realm } = created;
  if (prepare) {
    try {
      prepare(realm.window);
    } catch (error) {
      frame.remove();
      throw error;
    }
  }
  // Detached, the realm's documents have no execution context, so no CSP to check and report against (ADR 0013).
  const detached = isChromiumLike(doc);
  if (detached) frame.remove();
  realms.set(doc, { frame, realm, detached });
  return realm;
}
