const assert = require("node:assert/strict");
const fs = require("node:fs");

const previewJs = fs.readFileSync(new URL("../preview.js", `file://${__filename}`), "utf8");
const previewHtml = fs.readFileSync(new URL("../preview.html", `file://${__filename}`), "utf8");
const previewCss = fs.readFileSync(new URL("../preview.css", `file://${__filename}`), "utf8");

assert.match(previewJs, /className = "code-copy-button"/);
assert.match(previewJs, /copyCodeText\(rawCode, copyButton\)/);
assert.match(previewJs, /code\.dataset\.rawCode = rawCode/);
assert.match(previewJs, /copyTextWithButtonFeedback/);
assert.ok(
  previewHtml.indexOf('src="clipboard-utils.js"') < previewHtml.indexOf('src="preview.js"'),
  "clipboard-utils.js must load before preview.js"
);
assert.match(previewCss, /\.code-copy-button/);
assert.match(previewCss, /\[data-screen-only\].*display: none/s);
console.log("code-copy static tests passed");
