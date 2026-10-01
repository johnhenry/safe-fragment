/**
 * The parse realm: where the sanitizer engines parse untrusted markup (ADR 0012, safe-fragment#13).
 *
 * The default realm is an inert document made by `document.implementation.createHTMLDocument()`: no browsing
 * context, so nothing loads or runs. In Chromium that document still shares the page's execution context, and
 * Chromium's HTML parser checks the page's Content-Security-Policy while it parses: a `style=` attribute reports
 * `style-src-attr`, and (for the DOMPurify engine's `DOMParser` document) `<style>`/`<base>` report
 * `style-src-elem`/`base-uri`, although the output is clean and nothing is applied. Measured in twelve document
 * contexts, every one of them reports; the one that does not is the initial document of an `about:blank` iframe.
 *
 * So, where it matters, the engines parse in a hidden, empty, same-origin `about:blank` iframe that this module
 * keeps in the page (one per document, appended to `<html>`, never given a `src`, never run script, never shown
 * markup): the native engine builds its inert documents from the iframe's `DOMImplementation`, and DOMPurify is
 * created on the iframe's window. Untrusted markup is still only ever parsed into documents that have no browsing
 * context; the iframe is the factory, not a place content lives. Everything falls back to the default realm when
 * an iframe cannot be created or reached (a sandboxed page, no `<html>` yet), so this can only remove noise.
 *
 * `"auto"` (the default) uses the iframe only on Chromium-based engines, the only ones that report. They are
 * recognized by `navigator.userAgentData`, which only Chromium defines; Firefox and Safari keep the default realm.
 */
import { getSharedState } from "../shared-state.js";

export type InertRealmMode = "auto" | "iframe" | "document";

export interface InertRealm {
  /** The hidden iframe's window: where DOMPurify is created. */
  readonly window: Window;
  /** The iframe's `DOMImplementation`: what the native engine creates its inert documents from. */
  readonly implementation: DOMImplementation;
}

function isChromiumLike(doc: Document): boolean {
  const nav = doc.defaultView?.navigator as (Navigator & { userAgentData?: unknown }) | undefined;
  return nav !== undefined && nav.userAgentData !== undefined;
}

/** The inert realm for `doc`, or `undefined` to use the default one (`doc.implementation`, `doc.defaultView`). */
export function getInertRealm(doc: Document, mode: InertRealmMode = "auto"): InertRealm | undefined {
  if (mode === "document") return undefined;
  if (mode === "auto" && !isChromiumLike(doc)) return undefined;
  const realms = (getSharedState().realms ??= new WeakMap());
  const known = realms.get(doc);
  if (known !== undefined) {
    if (known === null) return undefined;
    if (known.frame.isConnected && known.frame.contentWindow && known.frame.contentDocument) return known.realm;
    realms.delete(doc); // the host removed it: make another
  }
  try {
    const host = doc.documentElement;
    const win = doc.defaultView;
    if (!host || !win) return undefined; // not ready yet: not cached, try again next time
    const frame = doc.createElement("iframe");
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
      realms.set(doc, null);
      return undefined;
    }
    const realm: InertRealm = { window: inner, implementation: innerDoc.implementation };
    realms.set(doc, { frame, realm });
    return realm;
  } catch {
    realms.set(doc, null);
    return undefined;
  }
}
