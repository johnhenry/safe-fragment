/**
 * Adversarial XSS regression corpus. Every entry here represents a known
 * class of sanitizer-bypass technique; every one must come out neutralized
 * from BOTH sanitization engines (native Sanitizer API and the DOMPurify
 * fallback) against the profile listed. See test/security/xss-corpus.test.ts,
 * which runs this list against both engines and asserts equivalent, safe
 * output.
 */

export interface ForbiddenAttribute {
  selector: string;
  attribute: string;
}

export interface XssFixture {
  name: string;
  /** Profile to sanitize the input against. */
  profile: string;
  input: string;
  /** Case-insensitive substrings that must NOT appear anywhere in the serialized output. */
  forbiddenSubstrings: string[];
  /** Attributes that, if the selector matches an element in the output, must be absent from it. */
  forbiddenAttributes?: ForbiddenAttribute[];
  /**
   * A documented, understood cross-engine difference: the named browsers are
   * exempt from the native-vs-DOMPurify equality check for this fixture (each
   * engine's output is still checked against the forbidden/survives lists).
   * Never use this to hide an unexplained difference.
   */
  knownDivergence?: { browsers: Array<"firefox" | "webkit" | "chromium">; reason: string };
  /** Benign text that must STILL be in the output's textContent (a sanitizer that deletes everything must not pass). */
  survives?: string[];
}

export const XSS_CORPUS: XssFixture[] = [
  {
    name: "img onerror",
    profile: "article-v1",
    input: '<p>hi</p><img src=x onerror="alert(1)">',
    forbiddenSubstrings: ["onerror", "alert(1)"],
    forbiddenAttributes: [{ selector: "img", attribute: "onerror" }],
    survives: ["hi"],
  },
  {
    name: "a href javascript: URL",
    profile: "article-v1",
    input: '<a href="javascript:alert(1)">click</a>',
    forbiddenSubstrings: ["javascript:"],
    forbiddenAttributes: [{ selector: "a", attribute: "href" }],
    survives: ["click"],
  },
  {
    name: "a href javascript: URL, mixed case",
    profile: "article-v1",
    input: '<a href="JaVaScRiPt:alert(1)">click</a>',
    forbiddenSubstrings: ["avascript:", "alert(1)"],
    forbiddenAttributes: [{ selector: "a", attribute: "href" }],
    survives: ["click"],
  },
  {
    name: "a href javascript: URL, tab-obfuscated scheme",
    profile: "article-v1",
    input: '<a href="java&#x09;script:alert(1)">click</a>',
    forbiddenSubstrings: ["javascript:", "alert(1)"],
    forbiddenAttributes: [{ selector: "a", attribute: "href" }],
    survives: ["click"],
  },
  {
    name: "a href javascript: URL, numeric-entity-encoded scheme",
    profile: "article-v1",
    input: '<a href="&#106;avascript:alert(1)">click</a>',
    forbiddenSubstrings: ["javascript:", "alert(1)"],
    forbiddenAttributes: [{ selector: "a", attribute: "href" }],
    survives: ["click"],
  },
  {
    name: "a href javascript: URL, leading-whitespace-obfuscated",
    profile: "article-v1",
    input: '<a href="  javascript:alert(1)">click</a>',
    forbiddenSubstrings: ["javascript:", "alert(1)"],
    forbiddenAttributes: [{ selector: "a", attribute: "href" }],
    survives: ["click"],
  },
  {
    name: "a href data: URL",
    profile: "article-v1",
    input: '<a href="data:text/html,<script>alert(1)</script>">click</a>',
    forbiddenSubstrings: ["data:text/html", "<script>"],
    forbiddenAttributes: [{ selector: "a", attribute: "href" }],
    survives: ["click"],
  },
  {
    name: "img src vbscript: URL",
    profile: "article-v1",
    input: '<img src="vbscript:msgbox(1)">',
    forbiddenSubstrings: ["vbscript:"],
    forbiddenAttributes: [{ selector: "img", attribute: "src" }],
  },
  {
    name: "a href file: URL",
    profile: "article-v1",
    input: '<a href="file:///etc/passwd">click</a>',
    forbiddenSubstrings: ["file:"],
    forbiddenAttributes: [{ selector: "a", attribute: "href" }],
    survives: ["click"],
  },
  {
    name: "svg onload",
    profile: "article-v1",
    input: '<p>before</p><svg onload="alert(1)"><circle r="5"/></svg><p>after</p>',
    forbiddenSubstrings: ["<svg", "onload", "<circle"],
    survives: ["before", "after"],
  },
  {
    name: "svg with embedded script element",
    profile: "article-v1",
    input: "<svg><script>alert(1)</script></svg>",
    forbiddenSubstrings: ["<svg", "<script", "alert(1)"],
  },
  {
    name: "MathML xlink:href javascript: abuse",
    profile: "article-v1",
    input: '<math><mtext><a xlink:href="javascript:alert(1)">x</a></mtext></math>',
    forbiddenSubstrings: ["<math", "xlink", "javascript:"],
  },
  {
    name: "form + formaction abuse",
    profile: "ui-v1",
    input: '<form><button formaction="javascript:alert(1)">go</button></form>',
    forbiddenSubstrings: ["<form", "formaction", "javascript:"],
    survives: ["go"],
  },
  {
    name: "button formaction on allowed element",
    profile: "ui-v1",
    input: '<button type="button" formaction="javascript:alert(1)">go</button>',
    forbiddenSubstrings: ["formaction", "javascript:"],
    forbiddenAttributes: [{ selector: "button", attribute: "formaction" }],
    survives: ["go"],
  },
  {
    name: "iframe srcdoc abuse",
    profile: "article-v1",
    input: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    forbiddenSubstrings: ["<iframe", "srcdoc", "<script"],
  },
  {
    name: "object/embed abuse",
    profile: "article-v1",
    input: '<object data="javascript:alert(1)"></object><embed src="javascript:alert(1)">',
    forbiddenSubstrings: ["<object", "<embed", "javascript:"],
  },
  {
    name: "nested/malformed anchor tags",
    profile: "article-v1",
    input: '<a href="https://good.example/"><a href="javascript:alert(1)">nested</a></a>',
    forbiddenSubstrings: ["javascript:"],
    survives: ["nested"],
  },
  {
    name: "noscript/title parser-confusion (mXSS-style)",
    knownDivergence: {
      browsers: ["firefox"],
      reason:
        "Firefox's native setHTML parses with the scripting flag ENABLED, so <noscript> content is raw text that ends at the first </noscript> (inside the attribute value) and the tail is parsed as markup; DOMPurify's DOMParser document parses with scripting DISABLED, so noscript holds elements and its whole subtree is dropped. Both outputs are fully enforced and pass the forbidden-substring check.",
    },
    profile: "article-v1",
    input: '<noscript><p title="</noscript><img src=x onerror=alert(1)>">x</p></noscript>',
    forbiddenSubstrings: ["onerror", "<noscript"],
  },
  {
    name: "listing raw-text element abuse",
    profile: "article-v1",
    input: "<listing><img src=x onerror=alert(1)></listing>",
    forbiddenSubstrings: ["<listing", "onerror"],
  },
  {
    name: "dangerous inline style (CSS expression / url(javascript:))",
    profile: "article-v1",
    input: '<p style="background:url(javascript:alert(1))">x</p>',
    forbiddenSubstrings: ["javascript:", 'style="'],
    forbiddenAttributes: [{ selector: "p", attribute: "style" }],
    survives: ["x"],
  },
  {
    name: "unregistered custom element abuse (ui-v1)",
    profile: "ui-v1",
    input: '<evil-widget onclick="alert(1)">x</evil-widget>',
    forbiddenSubstrings: ["evil-widget", "onclick", "alert(1)"],
    survives: ["x"],
  },
  {
    name: "customized built-in element (is= abuse)",
    profile: "article-v1",
    input: '<span is="evil-span" onclick="alert(1)">x</span>',
    forbiddenSubstrings: ["onclick", "is=", "evil-span"],
    survives: ["x"],
  },
  {
    name: "meta refresh redirect abuse",
    profile: "article-v1",
    input: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    forbiddenSubstrings: ["<meta", "javascript:"],
  },
  {
    name: "base tag hijack",
    profile: "article-v1",
    input: '<base href="https://evil.example/"><a href="/x">x</a>',
    forbiddenSubstrings: ["<base"],
    survives: ["x"],
  },
  {
    name: "on* attribute family, exhaustive-ish sample",
    profile: "article-v1",
    input: '<p onmouseover="alert(1)" onfocus="alert(1)" onanimationstart="alert(1)">x</p>',
    forbiddenSubstrings: ["onmouseover", "onfocus", "onanimationstart", "alert(1)"],
    survives: ["x"],
  },
  {
    name: "target=_blank without rel gets rel forced",
    profile: "article-v1",
    input: '<a href="https://good.example/" target="_blank">x</a>',
    forbiddenSubstrings: [],
    survives: ["x"],
  },
  {
    name: "comment-based mXSS smuggling attempt",
    profile: "article-v1",
    input: "<p>safe<!--<img src=x onerror=alert(1)>--></p>",
    forbiddenSubstrings: ["onerror"],
    survives: ["safe"],
  },
  {
    name: "template element smuggling",
    profile: "article-v1",
    input: "<div><template><img src=x onerror=alert(1)></template></div>",
    forbiddenSubstrings: ["onerror", "<template"],
  },
  // --- found by the mutation-XSS fuzzer (test/fuzz); each is a regression fixture ---
  {
    name: "F1 attribute value closes a raw-text context: noscript",
    profile: "article-v1",
    input: '<noscript><p title="</noscript><img src=x onerror=alert(1)>">x</p></noscript><p title="</noscript><img src=x onerror=alert(1)>">y</p>',
    forbiddenSubstrings: ["onerror", "</noscript"],
    forbiddenAttributes: [{ selector: "p", attribute: "title" }],
    survives: ["y"],
  },
  {
    name: "F1 attribute value with a comment closer",
    profile: "ui-v1",
    input: '<p title="x --> <img src=x onerror=alert(1)>">y</p><div class="a --!> b">z</div>',
    forbiddenSubstrings: ["onerror", "-->", "--!>"],
    forbiddenAttributes: [
      { selector: "p", attribute: "title" },
      { selector: "div", attribute: "class" },
    ],
    survives: ["y", "z"],
  },
  {
    name: "F1 attribute value with a CDATA closer and self-closing syntax",
    profile: "article-v1",
    input: '<img alt="]><img src=x onerror=alert(1)>" src="https://example.com/a.png"><p title="<br/>">w</p>',
    forbiddenSubstrings: ["onerror"],
    forbiddenAttributes: [
      { selector: "img", attribute: "alt" },
      { selector: "p", attribute: "title" },
    ],
    survives: ["w"],
  },
  {
    name: "F2 javascript:/data: value in a non-URL attribute",
    profile: "article-v1",
    input: '<h1 lang="javascript:alert(1)" title="data:text/html,<p>x</p>">a</h1><p title="java&#x09;script:alert(1)" dir="vbscript:x">b</p>',
    forbiddenSubstrings: ["javascript:", "data:text", "vbscript:"],
    forbiddenAttributes: [
      { selector: "h1", attribute: "lang" },
      { selector: "h1", attribute: "title" },
      { selector: "p", attribute: "title" },
      { selector: "p", attribute: "dir" },
    ],
    survives: ["a", "b"],
  },
  {
    name: "F3 <frameset> in the body must not replace it (D1)",
    profile: "article-v1",
    input: '<p>before</p><frameset><frame src="https://example.com/"></frameset><p>after</p>',
    forbiddenSubstrings: ["<frameset", "<frame"],
    survives: ["before", "after"],
  },
];
