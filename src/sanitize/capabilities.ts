/**
 * Runtime feature detection for the native HTML Sanitizer API
 * (`Element.prototype.setHTML` / `ShadowRoot.prototype.setHTML`). Always
 * called with an explicit `Document`, never reaches for an ambient global
 * -- this file (like everything under src/) is safe to import in
 * Node/SSR; nothing here executes until a caller hands it a real
 * `Document` at render time.
 */
export function hasNativeSanitizer(doc: Document | undefined | null): boolean {
  if (!doc) return false;
  try {
    const template = doc.createElement("template");
    return typeof (template as unknown as { setHTML?: unknown }).setHTML === "function";
  } catch {
    return false;
  }
}
