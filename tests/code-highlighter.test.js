const assert = require("assert");

const Prism = require("/usr/local/slides_js/node_modules/prismjs");
require("/usr/local/slides_js/node_modules/prismjs/components/prism-python");
require("/usr/local/slides_js/node_modules/prismjs/components/prism-bash");
require("/usr/local/slides_js/node_modules/prismjs/components/prism-json");
require("/usr/local/slides_js/node_modules/prismjs/components/prism-typescript");
global.Prism = Prism;
require("../code-highlighter.js");

const H = global.XPDFCodeHighlight;
assert(H, "highlighter global should exist");
assert.strictEqual(H.normalizeLanguage("python3"), "python");
assert.strictEqual(H.normalizeLanguage("C++"), "cpp");
assert.strictEqual(H.normalizeLanguage("shell"), "bash");
assert.strictEqual(H.detectLanguage("def forward(self, x):\n    return torch.relu(x)"), "python");
assert.strictEqual(H.detectLanguage("const value = items.map((item) => item.id);"), "javascript");
assert.strictEqual(H.detectLanguage('{"ok": true, "items": [1, 2]}'), "json");

const raw = "def forward(self, x):\n    # keep comment\n    return torch.relu(x)";
const highlighted = Prism.highlight(raw, Prism.languages.python, "python");
assert(highlighted.includes('token keyword'));
assert(highlighted.includes('token comment'));

const classes = new Set();
const fakeCodeElement = {
  dataset: {},
  textContent: raw,
  innerHTML: "",
  classList: {
    add(value) { classes.add(value); },
    remove(value) { classes.delete(value); },
    [Symbol.iterator]() { return classes[Symbol.iterator](); }
  }
};
const fakePrism = {
  languages: { python: {} },
  highlightElement(element) {
    element.innerHTML = '<span class="token keyword">def</span> forward';
  }
};
const result = H.highlightElement(fakeCodeElement, "py", fakePrism);
assert.strictEqual(result.language, "python");
assert.strictEqual(result.highlighted, true);
assert(classes.has("language-python"));
assert.strictEqual(fakeCodeElement.dataset.rawCode, raw);

console.log("code-highlighter tests passed");
