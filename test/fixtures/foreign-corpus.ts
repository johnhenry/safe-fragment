/**
 * SVG / MathML corpus (safe-fragment#3, ADR 0010), for a profile derived with
 * `svg: "static"` and `mathml: "presentation"`. Benign pictures and formulas must
 * survive; the hostile entries are SVG attacks and the namespace-confusion mutation-XSS
 * family (the shapes behind the 2019-2020 DOMPurify bypasses: foreign-content breakouts
 * through `<style>`, `<textarea>`, `<title>`, `<mglyph>` and integration points, plus
 * attribute values that close a raw-text element). Run through BOTH engines and
 * compared by test/security/foreign-corpus.test.ts.
 */
export interface ForeignFixture {
  name: string;
  input: string;
  text?: string[];
  /** Selectors (in the output, SVG/MathML names are case-sensitive: use `[*|...]`-free plain selectors) that must match. */
  selectors?: string[];
  /** Case-insensitive substrings that must not appear in the serialized output. */
  forbidden?: string[];
  /** Selectors that must match nothing. */
  absent?: string[];
  /**
   * The native engine removes `<use>` unconditionally (the Sanitizer API's built-in baseline), so the two
   * engines differ on fixtures that contain it; the output of each is still checked.
   */
  nativeDropsUse?: true;
}

export const FOREIGN_BENIGN: ForeignFixture[] = [
  {
    name: "icon: path with stroke, accessible name and title",
    input:
      '<svg viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="check" fill="none"><title>Check</title><path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
    text: ["Check"],
    selectors: ["svg[viewBox='0 0 24 24'][role='img']", "svg path[d='M5 12l5 5L20 7'][stroke='currentColor']", "svg title"],
  },
  {
    name: "bar chart: rects, text labels, grouped transform, polyline, circle markers",
    input:
      '<svg viewBox="0 0 200 100" width="400" height="200"><g transform="translate(10 10) scale(1 1)" fill="#4a90d9"><rect x="0" y="40" width="30" height="50"></rect><rect x="40" y="20" width="30" height="70" fill="rgb(200 0 0)"></rect><rect x="80" y="60" width="30" height="30" rx="3" ry="3" fill-opacity="0.5"></rect></g><polyline points="0,90 40,60 80,70 120,20" fill="none" stroke="#333" stroke-dasharray="4 2"></polyline><circle cx="120" cy="20" r="3" fill="red"></circle><line x1="0" y1="95" x2="200" y2="95" stroke="#999"></line><text x="5" y="99" font-size="8" font-family="Arial, sans-serif" text-anchor="start">Q1</text><text x="45" y="99" font-size="8">Q2</text></svg>',
    text: ["Q1", "Q2"],
    selectors: ["svg g[transform='translate(10 10) scale(1 1)'] rect", "svg polyline[points='0,90 40,60 80,70 120,20']", "svg text[text-anchor='start']"],
  },
  {
    name: "gradient fill: linearGradient with stops, referenced by url(#id)",
    input:
      '<svg viewBox="0 0 10 10"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox"><stop offset="0%" stop-color="#f00"></stop><stop offset="100%" stop-color="#00f" stop-opacity="0.8"></stop></linearGradient><radialGradient id="g2" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="white"></stop><stop offset="1" stop-color="black"></stop></radialGradient></defs><rect width="10" height="5" fill="url(#g1)"></rect><circle cx="5" cy="8" r="2" fill="url(#g2) red"></circle></svg>',
    selectors: ["linearGradient stop", "radialGradient stop", "rect[fill]", "circle[fill]"],
  },
  {
    name: "text on a path and tspans",
    input:
      '<svg viewBox="0 0 100 50"><defs><path id="curve" d="M10 40 Q50 0 90 40"></path></defs><text font-size="6"><textPath href="#curve" startOffset="10%">Along the curve</textPath></text><text x="5" y="10"><tspan dx="1" dy="2">one</tspan><tspan>two</tspan></text></svg>',
    text: ["Along the curve", "one", "two"],
    selectors: ["textPath", "text tspan"],
  },
  {
    name: "clip path",
    input:
      '<svg viewBox="0 0 10 10"><defs><clipPath id="c" clipPathUnits="userSpaceOnUse"><circle cx="5" cy="5" r="4"></circle></clipPath></defs><rect width="10" height="10" fill="teal" clip-path="url(#c)"></rect></svg>',
    selectors: ["clipPath circle", "rect[clip-path]"],
  },
  {
    name: "symbol and use of a same-fragment id",
    input:
      '<svg viewBox="0 0 20 10"><defs><symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></symbol></defs><use href="#dot" x="0" y="0" width="10" height="10"></use><use xlink:href="#dot" x="10" width="10" height="10"></use></svg>',
    selectors: ["symbol circle"],
    nativeDropsUse: true,
  },
  {
    name: "inline svg between paragraphs",
    input: "<p>before</p><svg width='10' height='10'><rect width='10' height='10'></rect></svg><p>after</p>",
    text: ["before", "after"],
    selectors: ["p + svg rect + *, p + svg"],
  },
  {
    name: "MathML: the quadratic formula",
    input:
      '<math display="block"><mrow><mi>x</mi><mo>=</mo><mfrac><mrow><mo>-</mo><mi>b</mi><mo>&#xB1;</mo><msqrt><msup><mi>b</mi><mn>2</mn></msup><mo>-</mo><mn>4</mn><mi>a</mi><mi>c</mi></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac></mrow></math>',
    text: ["x", "b", "4"],
    selectors: ["math[display='block'] mfrac msqrt msup mn", "math mo"],
  },
  {
    name: "MathML: a matrix and scripts inline in a paragraph",
    input:
      '<p>Let <math><msub><mi>A</mi><mn>1</mn></msub></math> be <math display="inline"><mrow><mo>(</mo><mtable columnalign="center"><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr><mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable><mo>)</mo></mrow></math>.</p>',
    text: ["Let", "be"],
    selectors: ["p math msub", "mtable mtr mtd mn", "mtable[columnalign='center']"],
  },
  {
    name: "MathML: fraction with a thickness, over/under and spacing",
    input:
      '<math><mfrac linethickness="2px"><mi>a</mi><mi>b</mi></mfrac><mspace width="1em"></mspace><munderover><mo>&#x2211;</mo><mrow><mi>i</mi><mo>=</mo><mn>0</mn></mrow><mi>n</mi></munderover></math>',
    selectors: ["mfrac[linethickness='2px']", "mspace[width='1em']", "munderover mo"],
  },
];

export const FOREIGN_HOSTILE: ForeignFixture[] = [
  {
    name: "foreignObject carrying HTML, an iframe and a handler",
    input:
      '<p>k</p><svg><foreignObject width="10" height="10"><iframe src="javascript:alert(1)"></iframe><p onclick="alert(1)">x</p><img src=x onerror=alert(1)></foreignObject></svg>',
    text: ["k"],
    forbidden: ["foreignobject", "iframe", "onclick", "onerror", "javascript:", "alert"],
    absent: ["p[onclick]", "img"],
  },
  {
    name: "script and style inside svg",
    input:
      "<svg><script>alert(1)</script><style>@import url(javascript:alert(1));rect{fill:url(javascript:alert(1))}</style><rect width='1' height='1'></rect></svg>",
    forbidden: ["<script", "<style", "alert", "javascript:", "@import"],
    selectors: ["rect"],
  },
  {
    name: "animation that rewrites href after sanitization",
    input:
      '<svg><a><animate attributeName="href" values="javascript:alert(1)" begin="0s"></animate><set attributeName="href" to="javascript:alert(1)"></set><text x="1" y="1">click</text></a><circle r="5"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s"></animateTransform></circle></svg>',
    forbidden: ["animate", "<set", "javascript:", "attributename", "alert"],
  },
  {
    name: "event handler attributes on every kind of element",
    input:
      '<svg onload="alert(1)" onfocus="alert(2)"><circle r="5" onclick="alert(3)" onmouseover="alert(4)"></circle><g onbegin="alert(5)"><text onerror="alert(6)">t</text></g></svg><math onclick="alert(7)"><mi onmouseover="alert(8)">x</mi></math>',
    forbidden: ["onload", "onfocus", "onclick", "onmouseover", "onbegin", "onerror", "alert"],
    selectors: ["circle", "text", "mi"],
  },
  {
    name: "style attribute on svg and math elements",
    input: '<svg><rect width="1" height="1" style="fill:url(javascript:alert(1));behavior:url(x)"></rect></svg><math><mi style="color:red">x</mi></math>',
    forbidden: ["style=", "behavior", "alert"],
  },
  {
    name: "use pointing outside the fragment: data:, external, protocol-relative, javascript:, mixed",
    input:
      '<svg><use href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+"></use><use href="https://evil.example/x.svg#a"></use><use href="//evil.example/x.svg#a"></use><use xlink:href="javascript:alert(1)"></use><use href="x.svg#a"></use><use href="#ok"></use><circle id="ok" r="1"></circle></svg>',
    forbidden: ["data:", "evil.example", "javascript:", "x.svg", "alert"],
    selectors: ["circle"],
    nativeDropsUse: true,
  },
  {
    name: "image, a, filter, mask, pattern, marker, switch, cursor, metadata",
    input:
      '<svg><image href="https://evil.example/x.png" onerror="alert(1)"></image><a href="javascript:alert(1)"><circle r="1"></circle></a><filter id="f"><feImage href="https://evil.example/x"></feImage></filter><mask id="m"><rect width="1" height="1"></rect></mask><pattern id="p"><rect width="1" height="1"></rect></pattern><marker id="k"></marker><switch><text>sw</text></switch><cursor href="x"></cursor><metadata>meta</metadata><rect width="2" height="2"></rect></svg>',
    forbidden: ["<image", "<a", "<filter", "feimage", "<mask", "<pattern", "<marker", "<switch", "<cursor", "metadata", "evil.example", "javascript:", "alert"],
    selectors: ["rect"],
  },
  {
    name: "paint values that reference or smuggle: external url(), CSS escapes, quotes, javascript:, mixed",
    input:
      '<svg><path d="M0 0" fill="url(https://evil.example/x.svg#a)"></path><path d="M0 0" fill="u\\72l(https://evil.example/)"></path><path d="M0 0" fill=\'url("javascript:alert(1)")\'></path><path d="M0 0" clip-path="url(javascript:alert(1))"></path><path d="M0 0" stroke="url(#g) javascript:alert(1)"></path><path d="M0 0" fill="red;background:url(javascript:alert(1))"></path><path d="M0 0" fill="expression(alert(1))"></path><path d="M0 0" fill="/*x*/red"></path></svg>',
    forbidden: ["evil.example", "javascript:", "alert", "expression", "u\\72l", "/*"],
    selectors: ["path"],
  },
  {
    name: "path data, points and transform that are not numbers",
    input:
      '<svg><path d="M0 0 javascript:alert(1)"></path><polygon points="0,0 1,1 onload=alert(1)"></polygon><g transform="translate(1) url(javascript:alert(1))"><rect width="1" height="1"></rect></g><g transform="scale(1)evil(1)"><rect width="1" height="1"></rect></g></svg>',
    forbidden: ["javascript:", "alert", "onload", "evil("],
  },
  {
    name: "title and desc with element children (HTML integration points)",
    input: '<svg><title><img src=x onerror=alert(1)></title><desc><p>x</p><script>alert(1)</script></desc><rect width="1" height="1"></rect></svg>',
    forbidden: ["onerror", "<script", "alert", "<img"],
    selectors: ["rect"],
  },
  {
    name: 'namespace confusion: <svg><p><style><img src="</style>..."> (foreign-content breakout through an attribute)',
    input: '<svg><p><style><img src="</style><img src=x onerror=alert(1)>"></style></p></svg><p>after</p>',
    text: ["after"],
    forbidden: ["onerror", "alert", "<style", "</style"],
  },
  {
    name: 'namespace confusion: <math><mtext><table><mglyph><style><!--</style><img title="-->...">',
    input:
      '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;"></style></mglyph></table></mtext></math><p>after</p>',
    text: ["after"],
    forbidden: ["onerror", "alert", "mglyph", "<style"],
  },
  {
    name: "namespace confusion: mglyph / svg / mtext / textarea with an id that closes the textarea",
    input:
      '<math><mtext><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=x>"></textarea></mtext></svg></mglyph></mtext></math><p>after</p>',
    text: ["after"],
    forbidden: ["onerror", "alert", "mglyph", "textarea"],
  },
  {
    name: 'namespace confusion: <svg></p><style><a id="</style><img onerror=...">',
    input: '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>"></style></svg><p>after</p>',
    text: ["after"],
    forbidden: ["onerror", "alert", "<style", "</style"],
  },
  {
    name: "namespace confusion: form, math, mtext, mglyph, svg, style, path id",
    input: '<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">',
    forbidden: ["onerror", "alert", "<form", "mglyph", "<style"],
  },
  {
    name: "MathML annotation-xml and semantics carrying HTML",
    input:
      '<math><semantics><mrow><mi>x</mi></mrow><annotation-xml encoding="text/html"><img src=x onerror=alert(1)><iframe src="javascript:alert(2)"></iframe></annotation-xml><annotation encoding="application/x-tex">\\frac{x}{y}</annotation></semantics></math><p>after</p>',
    text: ["after"],
    forbidden: ["onerror", "alert", "annotation", "semantics", "iframe", "javascript:"],
    absent: ["img", "iframe"],
  },
  {
    name: "MathML maction, mglyph, malignmark, href and xlink:href anywhere",
    input:
      '<math href="javascript:alert(1)"><maction actiontype="statusline#http://evil.example" xlink:href="javascript:alert(2)"><mi href="javascript:alert(3)" xlink:href="javascript:alert(4)">x</mi><mglyph src="x" alt="y"></mglyph><malignmark></malignmark></maction><mrow xlink:href="javascript:alert(5)"><mi>y</mi></mrow></math>',
    forbidden: ["javascript:", "alert", "maction", "mglyph", "malignmark", "href", "evil.example"],
  },
  {
    name: "an svg inside a MathML text integration point, and math inside svg text",
    input:
      '<math><mi><svg><circle r="1" onload="alert(1)"></circle></svg></mi><mtext><svg><rect width="1" height="1"></rect></svg></mtext></math><svg><text><math><mi>x</mi></math></text><desc><math><mi>y</mi></math></desc></svg>',
    forbidden: ["onload", "alert"],
    absent: ["math svg", "svg math", "mi circle", "mtext rect"],
  },
  {
    name: "CDATA, comments and processing instructions in foreign content",
    input:
      "<svg><text><![CDATA[<img src=x onerror=alert(1)>]]></text><!--<img src=x onerror=alert(2)>--><?xml-stylesheet href=\"javascript:alert(3)\"?><rect width='1' height='1'></rect></svg>",
    forbidden: ["<img", "<!--", "<?", "javascript:"],
    selectors: ["rect"],
  },
  {
    name: "attribute names that are namespaced or look namespaced: xmlns, xml:*, xlink:*",
    input:
      '<svg xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xlink:type="simple" xlink:show="new" xlink:actuate="onLoad" xlink:title="t"><circle xlink:href="javascript:alert(1)" r="1"></circle></svg>',
    forbidden: ["xmlns", "xml:", "xlink:", "javascript:", "alert"],
    selectors: ["circle"],
  },
  {
    name: "ids and references: same-fragment only, prefixed, invalid ids dropped",
    input:
      '<svg><defs><linearGradient id="a b"><stop offset="0"></stop></linearGradient><linearGradient id="ok.1_x-y" href="#other"></linearGradient><circle id="x:y" r="1"></circle></defs><rect width="1" height="1" fill="url(#ok.1_x-y)" aria-labelledby="t1 t2"></rect><title id="t1">t</title></svg>',
    selectors: ["rect[fill='url(#user-content-ok.1_x-y)']", "linearGradient[id='user-content-ok.1_x-y'][href='#user-content-other']"],
    forbidden: ['id="a b"', 'id="x:y"'],
  },
  {
    name: "attribute values that close a raw-text element, in svg and math attributes",
    input:
      '<svg><circle r="1" fill="red" id="x</style>"></circle><text x="1" class="</title><img src=x onerror=alert(1)>">t</text></svg><math><mi mathvariant="--&gt;&lt;img src=x onerror=alert(1)&gt;">x</mi></math>',
    forbidden: ["onerror", "alert", "</style", "</title"],
  },
  {
    name: "deeply nested svg and g (no stack overflow, no loss)",
    input: "<svg>" + "<g>".repeat(300) + '<rect width="1" height="1"></rect>' + "</g>".repeat(300) + "</svg>",
    selectors: ["rect"],
  },
];
