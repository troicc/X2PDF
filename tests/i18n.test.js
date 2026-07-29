const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(new URL("../i18n.js", `file://${__filename}`), "utf8");

function createContext(language) {
  const nodes = [];
  const document = {
    readyState: "complete",
    title: "",
    documentElement: { lang: "" },
    querySelectorAll() { return nodes; }
  };
  const context = {
    navigator: { language },
    document,
    chrome: { i18n: { getUILanguage: () => language } }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context;
}

const english = createContext("en-US");
assert.equal(english.XPDFI18n.locale, "en");
assert.equal(english.XPDFI18n.t("downloadPdf"), "Download PDF");
assert.equal(english.XPDFI18n.t("outputSummary", { heading: 2, quote: 1, code: 3, formula: 4, image: 5 }), "Output: 2 headings, 1 quotes, 3 code blocks, 4 formulas, and 5 images.");

const chinese = createContext("zh-CN");
assert.equal(chinese.XPDFI18n.locale, "zh");
assert.equal(chinese.XPDFI18n.t("downloadPdf"), "直接下载 PDF");

console.log("i18n tests passed");
