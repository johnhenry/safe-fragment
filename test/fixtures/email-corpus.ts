/**
 * email-v1 corpus (safe-fragment#2). Benign entries are written the way real
 * mail is: full documents, nested layout tables, Outlook conditional comments with
 * VML buttons, Word-generated markup, quoted replies, inline `cid:` images, tracking
 * pixels. The hostile entries are the email-specific abuse: conditional-comment
 * tricks, VML/Office XML, `cid:` and `background` URLs, layout attributes carrying
 * code. Run by test/security/email-corpus.test.ts through BOTH engines with a
 * `resolveCid`, and compared.
 */
export interface EmailFixture {
  name: string;
  input: string;
  /** Substrings of the output's textContent that must be there. */
  text?: string[];
  /** Selectors that must match something. */
  selectors?: string[];
  /** Case-insensitive substrings that must NOT appear in the serialized output or textContent. */
  forbidden?: string[];
  /** Text that must NOT be in textContent (VML fallback text, Office XML values). */
  noText?: string[];
}

/** The resolver the corpus test hands to the sanitizer: known ids map to attachment URLs, everything else to nothing. */
export const EMAIL_CID_MAP: Record<string, string> = {
  "logo.png@mail.example": "https://cdn.example/att/logo.png",
  "hero@mail.example": "blob:https://app.example/6c1d2c9e-0000-4000-8000-000000000001",
  "pixel@mail.example": "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
};

export const EMAIL_BENIGN: EmailFixture[] = [
  {
    name: "marketing newsletter: nested layout tables, preheader, MSO bulletproof button, footer",
    input: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Autumn sale</title>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style type="text/css">body{margin:0;padding:0}table{border-collapse:collapse}.btn{background:#c00}</style>
</head>
<body style="margin:0;padding:0" bgcolor="#f4f4f4">
<div style="display:none;max-height:0">PREHEADER-TEXT Save 30% this week only</div>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f4f4f4">
<tr><td align="center">
<table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" bgcolor="#ffffff" align="center">
<tr><td align="center" bgcolor="#222222" height="80"><img src="https://cdn.example/img/header.png" width="600" height="80" alt="Acme" border="0" style="display:block"></td></tr>
<tr><td style="padding:20px" align="left" valign="top"><h1 style="font-size:24px">Autumn sale</h1><p>Everything is <strong>30% off</strong>. <a href="https://example.com/sale?utm_source=mail">Shop now</a>.</p></td></tr>
<tr><td align="center" style="padding:10px">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://example.com/sale" style="height:40px;width:200px;" arcsize="10%" stroke="f" fillcolor="#cc0000"><w:anchorlock/><center style="color:#ffffff;">OUTLOOK-BUTTON-LABEL</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td bgcolor="#cc0000" align="center"><a href="https://example.com/sale" target="_blank" style="color:#fff">View the sale</a></td></tr></table><!--<![endif]-->
</td></tr>
<tr><td align="center" bgcolor="#eeeeee" style="font-size:12px"><font face="Arial" size="1" color="#666666">You received this because you subscribed. <a href="https://example.com/unsubscribe?u=1">Unsubscribe</a> | <a href="mailto:help@example.com">help@example.com</a></font><img src="https://track.example/o.gif?id=abc" width="1" height="1" alt="" border="0"></td></tr>
</table></td></tr></table></body></html>`,
    text: ["Autumn sale", "30% off", "Shop now", "View the sale", "Unsubscribe", "help@example.com"],
    selectors: ["table table td a[href^='https://example.com/sale']", "td[bgcolor='#cc0000']", "img[width='600'][height='80']", "font[face='Arial']"],
    noText: ["OUTLOOK-BUTTON-LABEL", "96", "body{margin"],
    forbidden: ["style=", "<style", "v:roundrect", "o:officedocumentsettings", "mso", "<!--"],
  },
  {
    name: "transactional receipt: itemized table with right-aligned cells and header cells",
    input: `<table width="100%" cellpadding="6" cellspacing="0" border="1" summary="Order 1042"><caption>Order 1042</caption><thead><tr bgcolor="#eee"><th align="left" scope="col">Item</th><th align="right" scope="col">Qty</th><th align="right" scope="col">Price</th></tr></thead><tbody><tr><td>Widget</td><td align="right">2</td><td align="right">$9.00</td></tr><tr><td colspan="2" align="right"><b>Total</b></td><td align="right"><b>$18.00</b></td></tr></tbody></table><p>Questions? Reply to this email.</p>`,
    text: ["Order 1042", "Widget", "$18.00", "Questions?"],
    selectors: ["table[summary='Order 1042']", "thead th[scope='col']", "td[colspan='2'][align='right']"],
  },
  {
    name: "Word-generated mail: o:p markers, MsoNormal paragraphs, Office XML block, font tags",
    input: `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=Generator content="Microsoft Word 15"><!--[if gte mso 9]><xml><w:WordDocument><w:View>Normal</w:View><w:Zoom>0</w:Zoom></w:WordDocument></xml><![endif]--></head><body lang=EN-US link="#0563C1"><div class=WordSection1><p class=MsoNormal><span lang=EN-US>Hello Sam,<o:p></o:p></span></p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal><font face="Calibri" size=3>Minutes attached.</font><o:p></o:p></p><p class=MsoNormal>Thanks,<br>Alex<o:p></o:p></p></div></body></html>`,
    text: ["Hello Sam,", "Minutes attached.", "Thanks,", "Alex"],
    selectors: ["p", "span[lang='EN-US']", "font[face='Calibri']", "br"],
    noText: ["Normal0"],
    forbidden: ["mso", "class="],
  },
  {
    name: "plain reply: quoted blockquote chain, signature rule, links",
    input: `<div dir="ltr">Sounds good, see you at 3.<br clear="all"><div><br></div>-- <br><div class="gmail_signature"><b>Sam</b><br><a href="https://example.com">example.com</a></div></div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Tue, Alex wrote:<br></div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex"><div dir="ltr">Lunch at 3?<blockquote class="gmail_quote"><div>Earlier thread</div></blockquote></div></blockquote></div>`,
    text: ["Sounds good", "Sam", "Lunch at 3?", "Earlier thread"],
    selectors: ["blockquote blockquote", "a[href='https://example.com']"],
    forbidden: ["gmail_quote", "style="],
  },
  {
    name: "inline cid images: logo in a cell, hero as a background, tracking pixel",
    input: `<table width="600" align="center" background="cid:hero@mail.example"><tbody><tr><td><img src="cid:logo.png@mail.example" width="120" height="40" alt="Logo"><p>Welcome aboard.</p><img src="cid:pixel@mail.example" width="1" height="1" alt=""></td></tr></tbody></table>`,
    text: ["Welcome aboard."],
    selectors: [
      "table[background^='blob:https://app.example/']",
      "img[src='https://cdn.example/att/logo.png'][alt='Logo']",
      "img[src^='data:image/gif;base64,'][width='1']",
    ],
    forbidden: ["cid:"],
  },
  {
    name: "calendar-style invite with a list, definition list and an address block",
    input: `<h2 align="center">Team offsite</h2><ul><li>Venue: Pier 9</li><li>Start: <abbr title="9 a.m.">09:00</abbr></li></ul><dl><dt>Bring</dt><dd>Laptop</dd></dl><address>1 Pier Road<br>Harbor City</address><hr width="50%" align="center">`,
    text: ["Team offsite", "Pier 9", "09:00", "Laptop", "Harbor City"],
    selectors: ["h2[align='center']", "dl dt", "address", "hr[width='50%']"],
  },
];

export const EMAIL_HOSTILE: EmailFixture[] = [
  {
    name: "script inside an MSO conditional comment",
    input: "<p>a</p><!--[if mso]><script>alert(1)</script><img src=x onerror=alert(1)><![endif]--><p>b</p>",
    text: ["a", "b"],
    forbidden: ["alert", "onerror", "<script"],
  },
  {
    name: "downlevel-revealed conditional: the markup is real and must be sanitized",
    input: "<![if mso]><img src=x onerror=alert(1)><a href=javascript:alert(2)>l</a><![endif]><p>b</p>",
    text: ["b"],
    forbidden: ["onerror", "javascript:", "alert"],
  },
  {
    name: "comment closer smuggled before a conditional",
    input: "<!--[if mso]>--><img src=x onerror=alert(1)><!--<![endif]--><p>b</p>",
    text: ["b"],
    forbidden: ["onerror", "alert"],
  },
  {
    name: "conditional comment whose end marker never comes",
    input: "<p>a</p><!--[if mso]><b>hidden</b><p>b</p>",
    text: ["a"],
    noText: ["hidden"],
    forbidden: ["<!--"],
  },
  {
    name: "VML shapes with javascript:, data: and handlers, outside comments",
    input:
      '<v:shape href="javascript:alert(1)" onclick="alert(2)"><v:imagedata src="javascript:alert(3)"></v:imagedata><v:fill src="data:text/html,x"></v:fill><v:textbox>VML-FALLBACK-TEXT</v:textbox></v:shape><p>ok</p>',
    text: ["ok"],
    noText: ["VML-FALLBACK-TEXT"],
    forbidden: ["javascript:", "onclick", "v:shape", "alert"],
  },
  {
    name: "Office XML block outside a comment leaks nothing",
    input: "<xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><p>ok</p>",
    text: ["ok"],
    noText: ["96"],
    forbidden: ["officedocumentsettings"],
  },
  {
    name: "o:p with a handler is unwrapped, handler gone",
    input: '<p>x<o:p onclick="alert(1)" style="a:b">&nbsp;</o:p></p>',
    text: ["x"],
    forbidden: ["onclick", "o:p", "alert"],
  },
  {
    name: "background attributes: javascript:, data:, relative, vbscript:",
    input:
      '<table background="javascript:alert(1)"><tbody><tr><td background="data:image/png;base64,AAAA">a</td><th background="/relative.png">b</th></tr><tr><td background="vbscript:x">c</td></tr></tbody></table>',
    text: ["a", "b", "c"],
    forbidden: ["javascript:", "data:image", "vbscript:", "background="],
  },
  {
    name: "cid: where it must not resolve: link, form-ish, unknown id",
    input: '<a href="cid:logo.png@mail.example">x</a><img src="cid:unknown@mail.example" alt="u"><p>y</p>',
    text: ["x", "y"],
    forbidden: ["cid:", "logo.png"],
  },
  {
    name: "cid: with an attribute-breaking content-id and entity tricks",
    input: `<img src="cid:x&quot; onerror=&quot;alert(1)" alt="a"><img src='cid:"onerror=alert(1)//' alt="b"><img src="cid:%22%20onerror%3Dalert(1)" alt="c">`,
    forbidden: ["onerror", "alert", "cid:"],
  },
  {
    name: "cid: case and whitespace obfuscation",
    input: '<img src=" CID:logo.png@mail.example" alt="a"><img src="c\tid:hero@mail.example" alt="b"><img src="ci\nd:pixel@mail.example" alt="c">',
    forbidden: ["javascript:", "onerror"],
  },
  {
    name: "layout attributes carrying code",
    input:
      '<table width="100%" bgcolor="red;background:url(javascript:alert(1))" onclick="alert(1)" align="expression(alert(1))" style="x:y"><tbody><tr><td width="javascript:alert(1)" height="1;2" valign="<script>alert(1)</script>" nowrap="nowrap" bgcolor="</style><img src=x onerror=alert(1)>">cell</td></tr></tbody></table>',
    text: ["cell"],
    forbidden: ["onclick", "onerror", "<script", "style=", "</style"],
  },
  {
    name: "font face/size/color carrying markup breakouts",
    input: '<font face="</noscript><img src=x onerror=alert(1)>" color="javascript:alert(1)" size="--><img src=x onerror=alert(2)>">t</font>',
    text: ["t"],
    forbidden: ["onerror", "javascript:", "alert", "</noscript"],
  },
  {
    name: "style element and attribute remain unsupported (ADR 0006)",
    input:
      '<style>td{background:url(javascript:alert(1))}</style><table style="behavior:url(x.htc)"><tbody><tr><td style="x:expression(alert(1))">c</td></tr></tbody></table>',
    text: ["c"],
    noText: ["background:url"],
    forbidden: ["<style", "style=", "expression", "behavior", "alert"],
  },
  {
    name: "tracking pixel with srcset/ping smuggling",
    input: '<img src="https://track.example/p.gif" srcset="javascript:alert(1) 1x" ping="https://track.example/ping" alt="">',
    forbidden: ["srcset", "ping", "javascript:"],
    selectors: ["img[src='https://track.example/p.gif']"],
  },
  {
    name: "base/meta/link/form in a mail document",
    input:
      '<html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/"><link rel="stylesheet" href="https://evil.example/x.css"></head><body><form action="https://evil.example/"><input name=a><button formaction="javascript:alert(1)">go</button></form><p>body</p></body></html>',
    text: ["body"],
    forbidden: ["<base", "<meta", "<link", "<form", "<input", "formaction", "javascript:"],
  },
];
