import type { Rng } from "./prng.js";
import { XSS_CORPUS } from "../fixtures/xss-corpus.js";
import { BENIGN_CORPUS } from "../fixtures/benign-corpus.js";

/**
 * Markup generator for the mutation-XSS fuzzer. Three strategies, mixed:
 *   1. a corpus entry (XSS or benign) mutated a few times;
 *   2. a sentence assembled from grammar fragments;
 *   3. a corpus entry spliced into a grammar sentence.
 * The fragments target the places HTML parsers disagree with serializers:
 * namespace switches (svg/math integration points), raw-text and RCDATA
 * elements, attribute quoting, entities, and comment/CDATA/PI tricks.
 */

/** Foreign-content entry/exit points and integration points. */
const NAMESPACE = [
  "<svg>",
  "</svg>",
  "<math>",
  "</math>",
  "<svg><foreignObject>",
  "</foreignObject>",
  "<svg><desc>",
  "<svg><title>",
  "<math><mtext>",
  "<math><mi>",
  "<math><annotation-xml encoding=text/html>",
  "<math><annotation-xml encoding=application/xhtml+xml>",
  "<mglyph>",
  "<malignmark>",
  "<svg><style>",
  "<math><style>",
  "<svg><a xlink:href=javascript:alert(1)>",
  "<svg><use href=data:image/svg+xml,x>",
  "<svg><set attributeName=href to=javascript:alert(1)>",
  "<svg><animate attributeName=href values=javascript:alert(1)>",
  "<svg><image href=x onerror=alert(1)>",
  "<svg><script>",
  "<svg><![CDATA[",
  "<math><![CDATA[",
  "<svg></p>",
  "<math></br>",
  "<svg><p>",
  "<math><p>",
  "<svg><b><",
  "<svg><font color=red>",
  "<svg><img src=x onerror=alert(1)>",
  "<svg><table><tr><td>",
  "<table><svg>",
  "<table><math>",
  "<select><svg>",
  "<noscript><svg>",
  "<template><svg>",
];

/** Raw-text, RCDATA and script-data elements (and their closers), where the tokenizer changes mode. */
const RAW_TEXT = [
  "<style>",
  "</style>",
  "<script>",
  "</script>",
  "<xmp>",
  "</xmp>",
  "<textarea>",
  "</textarea>",
  "<title>",
  "</title>",
  "<noscript>",
  "</noscript>",
  "<noembed>",
  "</noembed>",
  "<noframes>",
  "</noframes>",
  "<iframe>",
  "</iframe>",
  "<plaintext>",
  "<template>",
  "</template>",
  "<select>",
  "</select>",
  "<option>",
  "<listing>",
  "<style><!--",
  "<title><img src=x onerror=alert(1)>",
  "<textarea><img src=x onerror=alert(1)>",
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  "<style></style",
  "</style x>",
  "</script >",
  "</scrip",
];

/** Attribute syntax, quoting and name tricks (appended inside a start tag). */
const ATTRIBUTE_FORMS = [
  " a=b",
  ' a="b"',
  " a='b'",
  " a=`b`",
  ' a="b" c',
  " a=b/",
  " a",
  " a=",
  ' a="',
  " a='",
  "/a=b",
  " onerror=alert(1)",
  "/onerror=alert(1)",
  "\nonerror\n=\nalert(1)",
  ' onerror="alert(1)"',
  " ONERROR=alert(1)",
  ' title="x" title="y"',
  ' title="&quot; onerror=alert(1) x=&quot;"',
  " title='\"onerror=alert(1)'",
  ' title="`onerror=alert(1)"',
  " title=`x` onerror=alert(1)",
  ' href="x" href="javascript:alert(1)"',
  ' id="a" id="b"',
  ' class="a b"',
  ' class="user-a btn admin hidden"',
  " class='btn\tuser-x\nbtn'",
  " class=BTN",
  ' class="user-"',
  ' style="x:expression(alert(1))"',
  ' is="x-foo"',
  " <b>",
  '=">"',
  ' "="',
  " ' ",
  "\u0000",
  " a\u0000b=c",
  " xlink:href=x",
  " xmlns=http://www.w3.org/1999/xhtml",
  " xmlns:x=y",
];

const URLS = [
  "javascript:alert(1)",
  "JaVa\tScRiPt:alert(1)",
  "java&#x0A;script:alert(1)",
  "&#106;avascript:alert(1)",
  " javascript:alert(1)",
  "jav&#x61;script&colon;alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "data:image/svg+xml,<svg onload=alert(1)>",
  "vbscript:msgbox(1)",
  "blob:https://x/y",
  "file:///etc/passwd",
  "https://example.com/a?b=c",
  "http://example.com/",
  "//evil.example/x",
  "\\\\evil.example\\x",
  "/\\evil.example",
  "/relative/path",
  "relative",
  "#frag",
  "#x",
  "?q=1",
  "mailto:a@example.com",
  "tel:+1",
  "cid:part1@example.com",
  "CID:part1@example.com",
  "cid:",
  "cid:a b",
  "",
  " ",
];

const ENTITIES = [
  "&lt;",
  "&gt;",
  "&amp;",
  "&quot;",
  "&apos;",
  "&#60;",
  "&#x3c;",
  "&#x3C;",
  "&#0;",
  "&#x0;",
  "&#x110000;",
  "&#xD800;",
  "&#128;",
  "&#x80;",
  "&NewLine;",
  "&Tab;",
  "&colon;",
  "&lpar;",
  "&rpar;",
  "&amp",
  "&lt",
  "&ltscript&gt;",
  "&amp;lt;script&amp;gt;",
  "&#38;#60;",
  "&nbsp",
  "&notit;",
  "&not",
  "&#x26;lt;",
  "&&amp;",
  "&#",
  "&#x",
];

/** Comment, CDATA, doctype, PI and malformed-tag tricks. */
const COMMENTS = [
  "<!--",
  "-->",
  "--!>",
  "<!-->",
  "<!--->",
  "<!-- -- >",
  "<!--<img src=x onerror=alert(1)>-->",
  "<!--[if mso]>",
  "<![endif]-->",
  "<!--[if gte mso 9]><xml><o:OfficeDocumentSettings></o:OfficeDocumentSettings></xml><![endif]-->",
  "<!--[if !mso]><!-->",
  "<!--<![endif]-->",
  "<![CDATA[",
  "]]>",
  "<![CDATA[<img src=x onerror=alert(1)>]]>",
  "<?php echo 1 ?>",
  "<?xml version=1.0?>",
  "<!DOCTYPE html>",
  "<!x>",
  "<! x>",
  "</ >",
  "</>",
  "<//>",
  "<%",
  "%>",
  "</p",
  "<p <b>",
  "<",
  "</",
  "<!",
  "<!-",
  "<!--x--!>",
  "<a<b>",
  "<\u0000p>",
];

/** Element names across every profile, plus the dangerous ones. */
const TAGS = [
  "p",
  "a",
  "img",
  "div",
  "span",
  "table",
  "tr",
  "td",
  "th",
  "tbody",
  "thead",
  "caption",
  "col",
  "colgroup",
  "b",
  "i",
  "u",
  "em",
  "strong",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "button",
  "label",
  "form",
  "input",
  "textarea",
  "select",
  "option",
  "svg",
  "math",
  "mi",
  "mtext",
  "style",
  "script",
  "template",
  "iframe",
  "object",
  "embed",
  "base",
  "link",
  "meta",
  "noscript",
  "plaintext",
  "xmp",
  "details",
  "summary",
  "dialog",
  "marquee",
  "center",
  "font",
  "br",
  "hr",
  "pre",
  "code",
  "blockquote",
  "figure",
  "h1",
  "h2",
  "slot",
  "section",
  "nav",
  "x-widget",
  "ui--card",
  "my-el",
  "font-face",
  "annotation-xml",
  "foreignObject",
  "title",
  "head",
  "body",
  "html",
  "frameset",
  "frame",
  "applet",
  "audio",
  "video",
  "source",
  "track",
  "map",
  "area",
  "picture",
  "image",
  "use",
  "animate",
  "set",
  "v:shape",
  "o:p",
  "v:imagedata",
  "center",
];

const ATTRS = [
  "href",
  "src",
  "srcset",
  "style",
  "class",
  "id",
  "name",
  "title",
  "target",
  "rel",
  "onclick",
  "onerror",
  "onload",
  "data-action",
  "data-x",
  "xlink:href",
  "is",
  "formaction",
  "action",
  "background",
  "poster",
  "ping",
  "cite",
  "type",
  "value",
  "for",
  "headers",
  "aria-labelledby",
  "aria-controls",
  "slot",
  "part",
  "exportparts",
  "lang",
  "dir",
  "width",
  "height",
  "alt",
  "colspan",
  "rowspan",
  "align",
  "valign",
  "bgcolor",
  "cellpadding",
  "cellspacing",
  "border",
  "role",
  "tabindex",
  "srcdoc",
  "content",
  "http-equiv",
  "xmlns",
  "xmlns:xlink",
  "encoding",
  "attributeName",
  "begin",
  "to",
  "values",
  "from",
  "data",
  "longdesc",
  "usemap",
];

const TEXT = ["hello", "x", " ", "a b", "0", "\n", "\t", "<", ">", "&", " ", "​", "alert(1)", "]]>", "--", "\u0000", "﻿", "é"];

/** Characters inserted by the point mutator: the ones that change tokenizer state. */
const POINT = ["<", ">", '"', "'", "`", "&", "\u0000", "-", "!", "/", "=", " ", "\n", ";", ":", "#", "x", "\t", "?", "[", "]"];

function startTag(rng: Rng): string {
  const tag = rng.pick(TAGS);
  let out = `<${tag}`;
  const attrs = rng.int(4);
  for (let i = 0; i < attrs; i++) {
    if (rng.chance(0.55)) {
      const name = rng.pick(ATTRS);
      const url = rng.chance(0.5) ? rng.pick(URLS) : rng.pick(TEXT);
      const q = rng.pick(['"', "'", "", '"']);
      out += ` ${name}=${q}${url}${q}`;
    } else {
      out += rng.pick(ATTRIBUTE_FORMS);
    }
  }
  return out + rng.pick([">", ">", ">", "/>", " >", ""]);
}

function fragment(rng: Rng): string {
  switch (rng.int(9)) {
    case 0:
      return rng.pick(NAMESPACE);
    case 1:
      return rng.pick(RAW_TEXT);
    case 2:
      return rng.pick(ENTITIES);
    case 3:
      return rng.pick(COMMENTS);
    case 4:
      return `</${rng.pick(TAGS)}>`;
    case 5:
      return rng.pick(TEXT);
    default:
      return startTag(rng);
  }
}

function sentence(rng: Rng): string {
  const n = 1 + rng.int(9);
  let out = "";
  for (let i = 0; i < n; i++) out += fragment(rng);
  return out;
}

const SEEDS: string[] = [...XSS_CORPUS.map((f) => f.input), ...BENIGN_CORPUS.filter((f) => f.profile !== "plain-text-v1").map((f) => f.input)];

/** Extra seed inputs a feature adds to the pool (SVG/MathML, email, classes ...). */
const extraSeeds: string[] = [];
export function addSeeds(...inputs: string[]): void {
  extraSeeds.push(...inputs);
}
export function allSeeds(): readonly string[] {
  return [...SEEDS, ...extraSeeds];
}

export function mutate(rng: Rng, input: string): string {
  let s = input;
  const rounds = 1 + rng.int(4);
  for (let r = 0; r < rounds; r++) {
    const at = s.length === 0 ? 0 : rng.int(s.length + 1);
    switch (rng.int(8)) {
      case 0: // delete a range
        s = s.slice(0, at) + s.slice(at + 1 + rng.int(6));
        break;
      case 1: // duplicate a range
        s = s.slice(0, at) + s.slice(at, at + 1 + rng.int(12)) + s.slice(at);
        break;
      case 2: // insert a tokenizer-state character
        s = s.slice(0, at) + rng.pick(POINT) + s.slice(at);
        break;
      case 3: // insert a grammar fragment
        s = s.slice(0, at) + fragment(rng) + s.slice(at);
        break;
      case 4: // flip case of a character
        if (at < s.length) s = s.slice(0, at) + (s[at]! === s[at]!.toUpperCase() ? s[at]!.toLowerCase() : s[at]!.toUpperCase()) + s.slice(at + 1);
        break;
      case 5: // wrap in a namespace/raw-text opener
        s = rng.pick(NAMESPACE) + s;
        break;
      case 6: // swap two adjacent characters
        if (at + 1 < s.length) s = s.slice(0, at) + s[at + 1]! + s[at]! + s.slice(at + 2);
        break;
      default: // replace a URL-ish run with a URL
        s = s.slice(0, at) + rng.pick(URLS) + s.slice(at + rng.int(8));
    }
  }
  return s;
}

/** One fuzz input. Deterministic in `rng`. */
export function generate(rng: Rng): string {
  const seeds = allSeeds();
  switch (rng.int(5)) {
    case 0:
      return mutate(rng, rng.pick(seeds));
    case 1:
      return sentence(rng);
    case 2:
      return sentence(rng) + rng.pick(seeds) + sentence(rng);
    case 3:
      return mutate(rng, sentence(rng));
    default:
      return mutate(rng, rng.pick(seeds) + rng.pick(NAMESPACE) + sentence(rng));
  }
}
