/**
 * Collects `securitypolicyviolation` events from a document AND from every iframe document inserted into it while
 * watching (safe-fragment's parse realm is such an iframe, ADR 0012/0013). An about:blank iframe inherits its
 * creator's CSP, so a violation in it is as real as one in the page (a console error and, with report-uri/report-to,
 * a report), but it is dispatched to the iframe's own document: a listener on the page alone does not see it.
 *
 * The realm iframe can be inserted and removed in the same task, so a MutationObserver (asynchronous) would only ever
 * see it detached, without a document. The insertion methods of the watched document's window are wrapped instead,
 * and the observer is the safety net: an iframe it saw inserted that the wrappers did not is reported as a failure
 * entry (`unwatched-iframe`), so a new insertion path cannot silently make this blind again.
 */
export interface ViolationWatch {
  /** Waits for queued violation events, stops watching, and returns `directive@where blockedURI sample` entries. */
  stop(): Promise<string[]>;
  /** How many iframes were inserted into the watched document (and watched) so far. */
  readonly iframesSeen: number;
}

type Method = (this: Node, ...args: unknown[]) => unknown;
const INSERTERS: ReadonlyArray<["Node" | "Element", string]> = [
  ["Node", "appendChild"],
  ["Node", "insertBefore"],
  ["Node", "replaceChild"],
  ["Element", "append"],
  ["Element", "prepend"],
  ["Element", "before"],
  ["Element", "after"],
  ["Element", "replaceWith"],
  ["Element", "replaceChildren"],
  ["Element", "insertAdjacentElement"],
];

export function watchViolationsEverywhere(doc: Document, settleMs = 150): ViolationWatch {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win) throw new Error("watchViolationsEverywhere: the document has no window");
  const seen: string[] = [];
  const watchedDocs = new Map<Document, (e: Event) => void>();
  const hookedFrames = new Set<HTMLIFrameElement>();

  const listen = (target: Document, where: string): void => {
    if (watchedDocs.has(target)) return;
    const listener = (e: Event): void => {
      const v = e as SecurityPolicyViolationEvent;
      seen.push(`${v.violatedDirective}@${where} ${v.blockedURI} ${v.sample}`);
    };
    target.addEventListener("securitypolicyviolation", listener, true);
    watchedDocs.set(target, listener);
  };
  const frameDocs = (node: unknown): void => {
    if (!(node instanceof win.Element)) return;
    const frames = node.localName === "iframe" ? [node] : [...node.querySelectorAll("iframe")];
    for (const f of frames as HTMLIFrameElement[]) {
      hookedFrames.add(f);
      if (f.contentDocument) listen(f.contentDocument, f.hasAttribute("data-safe-fragment-realm") ? "realm" : "iframe");
    }
  };

  listen(doc, "page");
  for (const f of doc.querySelectorAll("iframe")) if (f.contentDocument) listen(f.contentDocument, "iframe"); // already there
  const restore: Array<() => void> = [];
  for (const [owner, name] of INSERTERS) {
    const proto = (owner === "Node" ? win.Node.prototype : win.Element.prototype) as unknown as Record<string, Method>;
    const original = proto[name]!;
    proto[name] = function (this: Node, ...args: unknown[]): unknown {
      const result = original.apply(this, args);
      for (const arg of args) frameDocs(arg);
      return result;
    };
    restore.push(() => {
      proto[name] = original;
    });
  }
  const insertedFrames = new Set<Node>();
  const observer = new win.MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) {
        if (n instanceof win.Element && n.localName === "iframe") insertedFrames.add(n);
        if (n instanceof win.Element) for (const f of n.querySelectorAll("iframe")) insertedFrames.add(f);
      }
  });
  observer.observe(doc, { childList: true, subtree: true });

  return {
    get iframesSeen() {
      return hookedFrames.size;
    },
    async stop() {
      await new Promise((r) => setTimeout(r, settleMs)); // violation events are queued as tasks
      for (const r of observer.takeRecords()) for (const n of r.addedNodes) if (n instanceof win.Element && n.localName === "iframe") insertedFrames.add(n);
      observer.disconnect();
      for (const undo of restore) undo();
      for (const [target, listener] of watchedDocs) target.removeEventListener("securitypolicyviolation", listener, true);
      for (const f of insertedFrames)
        if (!hookedFrames.has(f as HTMLIFrameElement)) seen.push("unwatched-iframe: an iframe was inserted by a path the watcher does not wrap");
      return seen;
    },
  };
}
