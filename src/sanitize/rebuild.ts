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
  const doc = source.ownerDocument;
  const out = doc.createDocumentFragment();
  const stack: Array<{ from: Node; to: Node }> = [{ from: source, to: out }];

  while (stack.length > 0) {
    const { from, to } = stack.pop() as { from: Node; to: Node };
    for (const child of from.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        to.appendChild(doc.createTextNode(child.nodeValue ?? ""));
      } else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element;
        const copy = doc.createElement(el.localName);
        for (const attr of el.attributes) {
          try {
            copy.setAttribute(attr.name, attr.value);
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
  return out;
}
