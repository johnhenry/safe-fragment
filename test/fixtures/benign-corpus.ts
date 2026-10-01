/**
 * Benign-content corpus. The XSS corpus proves hostile input is neutralized;
 * this one proves ordinary content SURVIVES (a sanitizer that deletes
 * everything passes every XSS test). Every entry is run through both engines
 * and compared, and each asserts the listed text/structure is still there.
 */
export interface BenignFixture {
  name: string;
  profile: string;
  input: string;
  /** Substrings that must be present in the output's textContent. */
  text?: string[];
  /** Selectors that must each match at least one element in the output. */
  selectors?: string[];
  /** Selectors that must match nothing in the output. */
  absent?: string[];
}

export const BENIGN_CORPUS: BenignFixture[] = [
  {
    name: "paragraph with inline formatting",
    profile: "article-v1",
    input: "<p>Hello <strong>bold</strong> and <em>italic</em> world.</p>",
    text: ["Hello bold and italic world."],
    selectors: ["p > strong", "p > em"],
  },
  {
    name: "headings h1-h6",
    profile: "article-v1",
    input: "<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h5>E</h5><h6>F</h6>",
    text: ["ABCDEF"],
    selectors: ["h1", "h2", "h3", "h4", "h5", "h6"],
  },
  {
    name: "unordered and ordered lists",
    profile: "article-v1",
    input: "<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><ol start=3><li>three</li></ol>",
    text: ["one", "two", "nested", "three"],
    selectors: ["ul ul li", "ol[start='3']"],
  },
  {
    name: "definition list",
    profile: "article-v1",
    input: "<dl><dt>Term</dt><dd>Definition</dd></dl>",
    text: ["Term", "Definition"],
    selectors: ["dl dt", "dl dd"],
  },
  {
    name: "link with https href",
    profile: "article-v1",
    input: '<p>See <a href="https://example.com/page?x=1#y" title="t">the page</a>.</p>',
    text: ["the page"],
    selectors: ["a[href='https://example.com/page?x=1#y'][title='t']"],
  },
  {
    name: "relative and mailto links",
    profile: "article-v1",
    input: '<a href="/docs/a">a</a> <a href="b.html">b</a> <a href="mailto:me@example.com">m</a> <a href="?q=1">q</a>',
    selectors: ["a[href='/docs/a']", "a[href='b.html']", "a[href='mailto:me@example.com']", "a[href='?q=1']"],
  },
  {
    name: "target=_blank link",
    profile: "article-v1",
    input: '<a href="https://example.com/" target="_blank">out</a>',
    selectors: ["a[target='_blank'][rel='noopener noreferrer']"],
  },
  {
    name: "fragment link and heading id",
    profile: "article-v1",
    input: '<a href="#intro">go</a><h2 id="intro">Intro</h2>',
    selectors: ["a[href='#user-content-intro']", "h2#user-content-intro"],
  },
  {
    name: "image with alt and size",
    profile: "article-v1",
    input: '<img src="https://example.com/a.png" alt="An image" width="10" height="20">',
    selectors: ["img[alt='An image'][width='10'][height='20']"],
  },
  {
    name: "figure with caption",
    profile: "article-v1",
    input: '<figure><img src="https://example.com/a.png" alt="x"><figcaption>Cap</figcaption></figure>',
    text: ["Cap"],
    selectors: ["figure > img", "figure > figcaption"],
  },
  {
    name: "blockquote with cite",
    profile: "article-v1",
    input: '<blockquote cite="https://example.com/q">Quote<footer>x</footer></blockquote>',
    text: ["Quote"],
    selectors: ["blockquote[cite]"],
    absent: ["footer"], // article-v1 has no <footer>: unwrapped, text kept
  },
  {
    name: "code and pre blocks keep whitespace",
    profile: "article-v1",
    input: "<pre><code>line 1\n  line 2 &lt;b&gt;</code></pre>",
    text: ["line 1\n  line 2 <b>"],
    selectors: ["pre > code"],
  },
  {
    name: "table with header and body",
    profile: "article-v1",
    input:
      '<table><caption>C</caption><thead><tr><th scope="col" colspan="2">H</th></tr></thead><tbody><tr><td>1</td><td rowspan="2">2</td></tr></tbody></table>',
    text: ["C", "H", "1", "2"],
    selectors: ["table > caption", "thead th[scope='col'][colspan='2']", "tbody td[rowspan='2']"],
  },
  {
    name: "entities and unicode text",
    profile: "article-v1",
    input: "<p>Fish &amp; chips &lt;3 &copy; café ☃ \u{1F600}</p>",
    text: ["Fish & chips <3 © café ☃ \u{1F600}"],
  },
  { name: "line breaks and horizontal rules", profile: "article-v1", input: "<p>a<br>b</p><hr><p>c</p>", text: ["ab", "c"], selectors: ["br", "hr"] },
  {
    name: "abbr time mark sub sup",
    profile: "article-v1",
    input: '<p><abbr title="HyperText">HTML</abbr> <time datetime="2026-01-02">Jan</time> <mark>m</mark> H<sub>2</sub>O x<sup>2</sup></p>',
    selectors: ["abbr[title]", "time[datetime]", "mark", "sub", "sup"],
  },
  { name: "lang and dir attributes", profile: "article-v1", input: '<p lang="ar" dir="rtl">مرحبا</p>', selectors: ["p[lang='ar'][dir='rtl']"] },
  { name: "top-level text with no element", profile: "article-v1", input: "just some text", text: ["just some text"] },
  {
    name: "presentational element marquee is unwrapped",
    profile: "article-v1",
    input: "<p>before <marquee>scroll <b>bold</b> text</marquee> after</p>",
    text: ["before scroll bold text after"],
    selectors: ["p > b"],
    absent: ["marquee"],
  },
  {
    name: "font and center are unwrapped",
    profile: "article-v1",
    input: '<center><font color="red">centered <em>em</em></font></center>',
    text: ["centered em"],
    selectors: ["em"],
    absent: ["font", "center"],
  },
  {
    name: "unknown element is unwrapped",
    profile: "article-v1",
    input: "<p>a<foo-bar>b<em>c</em></foo-bar>d<blink>e</blink></p>",
    text: ["abcde"],
    selectors: ["p > em"],
    absent: ["foo-bar", "blink"],
  },
  {
    name: "disallowed wrapper keeps allowed descendants",
    profile: "article-v1",
    input: "<section><article><p>deep <a href='https://example.com/'>link</a></p></article></section>",
    text: ["deep link"],
    selectors: ["p > a"],
    absent: ["section", "article"],
  },
  {
    name: "form controls are unwrapped, their text kept",
    profile: "article-v1",
    input: '<form action="/x"><label>Name <input name="n"></label><button>Go</button></form>',
    text: ["Name", "Go"],
    absent: ["form", "input", "label", "button"],
  },
  {
    name: "table cells unwrapped in ui-v1 (no tables)",
    profile: "ui-v1",
    input: "<table><tbody><tr><td>cell 1</td><td><b>cell 2</b></td></tr></tbody></table>",
    text: ["cell 1", "cell 2"],
    selectors: ["b"],
    absent: ["table", "td", "tr"],
  },
  { name: "u is unwrapped in ui-v1 and email-v1 keeps it", profile: "ui-v1", input: "<p>a <u>under</u> b</p>", text: ["a under b"], absent: ["u"] },
  {
    name: "ui-v1 button with action",
    profile: "ui-v1",
    input: '<button type="button" data-action="save" class="primary" aria-label="Save">Save</button>',
    text: ["Save"],
    selectors: ["button[type='button'][data-action='save'].primary[aria-label='Save']"],
  },
  {
    name: "ui-v1 submit button is forced inert",
    profile: "ui-v1",
    input: "<button type=submit>Go</button>",
    text: ["Go"],
    selectors: ["button[type='button']"],
  },
  {
    name: "ui-v1 layout containers",
    profile: "ui-v1",
    input:
      '<header class="h"><nav><a href="/a" role="link">A</a></nav></header><main><section class="s"><article>x</article></section></main><footer>f</footer>',
    text: ["A", "x", "f"],
    selectors: ["header.h nav a[role='link']", "main section.s article", "footer"],
  },
  {
    name: "ui-v1 label for button",
    profile: "ui-v1",
    input: '<label for="b1">Label</label><button id="b1" type="button">B</button>',
    selectors: ["label[for='user-content-b1']", "button#user-content-b1"],
  },
  {
    name: "ui-v1 aria relationships",
    profile: "ui-v1",
    input: '<div id="d1">d</div><button type="button" aria-controls="d1" aria-expanded="false">t</button>',
    selectors: ["button[aria-controls='user-content-d1'][aria-expanded='false']"],
  },
  {
    name: "ui-v1 unregistered custom element is unwrapped",
    profile: "ui-v1",
    input: "<div><my-unknown>kept <b>text</b></my-unknown></div>",
    text: ["kept text"],
    selectors: ["div > b"],
    absent: ["my-unknown"],
  },
  {
    name: "email-v1 table layout",
    profile: "email-v1",
    input: '<table cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="top" colspan="2">Hello</td></tr></table>',
    text: ["Hello"],
    selectors: ["table[cellpadding='0'] td[align='center'][valign='top'][colspan='2']"],
  },
  {
    name: "email-v1 inline content",
    profile: "email-v1",
    input: '<div><h1>T</h1><p>Hi <a href="https://example.com/">there</a><img src="https://example.com/p.png" alt="p"></p></div>',
    text: ["Hi there"],
    selectors: ["div h1", "p a", "p img[alt='p']"],
  },
  {
    name: "plain-text-v1 is literal text",
    profile: "plain-text-v1",
    input: "<p>not <b>markup</b></p> & stuff",
    text: ["<p>not <b>markup</b></p> & stuff"],
    absent: ["p", "b"],
  },
];
