/**
 * `<example-sandbox>` -- a SEPARATE component from `<safe-fragment>`,
 * for running arbitrary, application-authored, EXECUTABLE code examples
 * (documentation playgrounds, live demos). It intentionally allows full
 * script execution inside a sandboxed iframe.
 *
 * This component makes **no** safety claim about the code it runs, and
 * must never be used to render untrusted user input -- that is exactly
 * what `<safe-fragment>` exists for. `<example-sandbox>` is for markup the
 * *application author* wrote (or explicitly trusts), the same way a
 * documentation site trusts the code samples it ships.
 *
 * The one thing this component does provide is isolation from the host
 * page: the iframe is sandboxed with only `allow-scripts` (no
 * `allow-same-origin`, so the iframe gets a unique opaque origin and
 * cannot read the host page's cookies/localStorage/DOM even though
 * scripts inside it run; no `allow-top-navigation`, so it cannot redirect
 * the host page; no `allow-popups`, `allow-forms`, `allow-modals`).
 * Communication back to the host is a narrow, explicit `postMessage`
 * protocol (`ready` / `console` / `error`), authenticated by comparing
 * `event.source` to the iframe's own `contentWindow` -- not by trusting
 * `event.origin`, since an `allow-scripts`-only srcdoc iframe has an
 * opaque ("null") origin by design.
 */

const PROTOCOL_MARKER = "__safeFragmentExampleSandbox";

export interface ExampleSandboxDeps {
  /** noop placeholder for future dependency injection; kept for symmetry with safe-fragment-element's factory shape. */
  readonly _reserved?: never;
}

export function createExampleSandboxElementClass(HTMLElementBase: typeof HTMLElement) {
  return class ExampleSandboxElement extends HTMLElementBase {
    static get observedAttributes(): string[] {
      return ["height"];
    }

    #codeProperty: string | null = null;
    #iframe: HTMLIFrameElement | null = null;
    #messageListener: ((event: MessageEvent) => void) | null = null;

    connectedCallback(): void {
      if (!this.#iframe && this.#resolveCode() !== null) {
        this.run();
      }
    }

    disconnectedCallback(): void {
      this.#teardown();
    }

    get code(): string | null {
      return this.#codeProperty;
    }
    set code(value: string | null) {
      this.#codeProperty = value;
    }

    /** (Re)builds a fresh, isolated iframe running the current code. Always tears down any previous iframe first -- runs never share state. */
    run(): void {
      this.#teardown();
      const code = this.#resolveCode();
      if (code === null) {
        this.dispatchEvent(
          new CustomEvent("example-sandbox:error", { detail: { message: "No code source: set the .code property or add a <template> child." }, bubbles: true }),
        );
        return;
      }

      const iframe = this.ownerDocument.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("referrerpolicy", "no-referrer");
      iframe.style.border = "0";
      iframe.style.width = "100%";
      const height = this.getAttribute("height");
      if (height) iframe.style.height = height;

      const listener = (event: MessageEvent): void => {
        if (event.source !== iframe.contentWindow) return; // authenticate by source identity, not origin (opaque origin here)
        const data = event.data as { [PROTOCOL_MARKER]?: boolean; type?: string; payload?: unknown } | null;
        if (!data || data[PROTOCOL_MARKER] !== true) return;
        if (data.type === "ready") {
          this.dispatchEvent(new CustomEvent("example-sandbox:ready", { bubbles: true }));
        } else if (data.type === "console") {
          this.dispatchEvent(new CustomEvent("example-sandbox:message", { detail: data.payload, bubbles: true }));
        } else if (data.type === "error") {
          this.dispatchEvent(new CustomEvent("example-sandbox:error", { detail: data.payload, bubbles: true }));
        }
      };
      this.#messageListener = listener;
      this.ownerDocument.defaultView?.addEventListener("message", listener);

      iframe.srcdoc = buildSrcdoc(code);
      this.#iframe = iframe;
      this.appendChild(iframe);
    }

    reset(): void {
      this.#teardown();
    }

    #resolveCode(): string | null {
      if (this.#codeProperty !== null) return this.#codeProperty;
      const template = this.querySelector<HTMLTemplateElement>(":scope > template");
      if (template) return template.innerHTML;
      return null;
    }

    #teardown(): void {
      if (this.#messageListener) {
        this.ownerDocument.defaultView?.removeEventListener("message", this.#messageListener);
        this.#messageListener = null;
      }
      if (this.#iframe) {
        this.#iframe.remove();
        this.#iframe = null;
      }
    }
  };
}

function buildSrcdoc(userCode: string): string {
  // userCode is application-authored/trusted (see module doc comment) --
  // it is executed as real script inside the sandboxed iframe by design.
  // It is embedded via a JSON string literal (not string concatenation
  // into a bare <script> body) so that a code sample containing
  // "</script>" or other markup-like text cannot break out of the
  // surrounding <script> element; it's evaluated with `new Function`,
  // not by naive text injection into the HTML parser.
  const encoded = JSON.stringify(userCode);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"></head>
<body>
<div id="app"></div>
<script>
(function () {
  function post(type, payload) {
    parent.postMessage({ ${JSON.stringify(PROTOCOL_MARKER)}: true, type: type, payload: payload }, "*");
  }
  window.addEventListener("error", function (e) {
    post("error", { message: e.message, filename: e.filename, lineno: e.lineno });
  });
  window.addEventListener("unhandledrejection", function (e) {
    post("error", { message: String(e.reason) });
  });
  ["log", "warn", "error", "info", "debug"].forEach(function (method) {
    var original = console[method];
    console[method] = function () {
      var args = Array.prototype.slice.call(arguments).map(function (a) {
        try { return typeof a === "string" ? a : JSON.stringify(a); } catch (_e) { return String(a); }
      });
      post("console", { method: method, args: args });
      if (original) original.apply(console, arguments);
    };
  });
  post("ready", null);
  try {
    var userSource = ${encoded};
    var run = new Function(userSource);
    run();
  } catch (e) {
    post("error", { message: String(e && e.message ? e.message : e) });
  }
})();
</script>
</body></html>`;
}
