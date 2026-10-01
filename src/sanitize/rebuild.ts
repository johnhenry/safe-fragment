const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Rebuilds a (already enforced) fragment from scratch: every element is
 * re-created with `createElement(localName)` and only its surviving
 * attributes are copied across; text is copied by value.
 *
 * Why: a DOM node can carry hidden state that no attribute inspection can
 * see and no allowlist can remove. The concrete case is the "is value" of a
 * customized built-in element (`<span is="host-defined-ext">`): the parser
 * records it internally even after the `is` attribute is deleted, the HTML
 * serializer re-emits it, and inserting the node into a document whose
 * registry defines that customized built-in would upgrade it. A freshly
 * created element has no such state, so after this pass the output is
 * exactly the allowlisted attributes and text -- nothing inherited from the
 * engine's parse. Iterative (explicit stack) so deeply nested input cannot
 * overflow the call stack.
 */
export function rebuildFragment(source: DocumentFragment): DocumentFragment {
  return rebuildWithLength(source).fragment;
}

/**
 * Like `rebuildFragment`, and also returns an APPROXIMATE serialized length
 * accumulated during the same walk (text length plus tag/attribute overhead,
 * no entity escaping). Serializing the whole output just to measure it
 * doubled the cost of every render for a number that is informational only.
 */
export function rebuildWithLength(source: DocumentFragment): { fragment: DocumentFragment; length: number } {
  let length = 0;
  const doc = source.ownerDocument;
  const out = doc.createDocumentFragment();
  const stack: Array<{ from: Node; to: Node }> = [{ from: source, to: out }];

  while (stack.length > 0) {
    const { from, to } = stack.pop() as { from: Node; to: Node };
    for (const child of from.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        const text = child.nodeValue ?? "";
        length += text.length;
        to.appendChild(doc.createTextNode(text));
      } else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element;
        // Foreign (SVG/MathML) elements keep their namespace; createElement would make an HTML element of the same name.
        const copy =
          el.namespaceURI === HTML_NAMESPACE || el.namespaceURI === null ? doc.createElement(el.localName) : doc.createElementNS(el.namespaceURI, el.localName);
        length += el.localName.length * 2 + 5; // <tag></tag>
        for (const attr of el.attributes) {
          try {
            if (attr.namespaceURI) copy.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
            else copy.setAttribute(attr.name, attr.value);
            length += attr.name.length + attr.value.length + 4; // ` name=""`
          } catch {
            // An attribute name the DOM refuses to set cannot be a valid allowlisted name; drop it.
          }
        }
        to.appendChild(copy);
        stack.push({ from: el, to: copy });
      }
      // Anything else (comments, processing instructions) was already stripped; never copied.
    }
  }
  return { fragment: out, length };
}
