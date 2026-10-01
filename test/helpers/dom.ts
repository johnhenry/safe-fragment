/** Test helpers shared by the corpus and equivalence suites. */

/**
 * Canonical, attribute-order-insensitive serialization of a sanitized
 * fragment: adjacent text nodes are merged, attributes are sorted by name,
 * comments are kept visible (so an engine that leaks one is a visible
 * diff). Used to compare the native and DOMPurify engines.
 */
export function normalize(node: Node): string {
  const parts: string[] = [];
  let pendingText = "";
  const flush = (): void => {
    if (pendingText !== "") {
      parts.push(JSON.stringify(pendingText));
      pendingText = "";
    }
  };
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      pendingText += child.nodeValue ?? "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      flush();
      const el = child as Element;
      const attrs = [...el.attributes]
        .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
        .sort()
        .join(" ");
      parts.push(
        `<${el.localName}${el.namespaceURI === "http://www.w3.org/1999/xhtml" ? "" : `@${el.namespaceURI}`}${attrs ? " " + attrs : ""}>${normalize(el)}</${el.localName}>`,
      );
    } else {
      flush();
      parts.push(`#node${child.nodeType}`);
    }
  }
  flush();
  return parts.join("");
}

export function serialize(fragment: DocumentFragment): string {
  const div = document.createElement("div");
  div.appendChild(fragment.cloneNode(true));
  return div.innerHTML;
}
