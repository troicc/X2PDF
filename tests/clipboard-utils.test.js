const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(new URL("../clipboard-utils.js", `file://${__filename}`), "utf8");

async function testClipboardApiPath() {
  let received = null;
  const context = {
    navigator: {
      clipboard: {
        async writeText(text) { received = text; }
      }
    },
    document: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  const result = await context.XPDFClipboard.copyText("a\n  b");
  assert.equal(result, true);
  assert.equal(received, "a\n  b");
}

async function testLegacyFallbackPath() {
  let command = null;
  let appended = null;
  const textarea = {
    value: "",
    style: {},
    setAttribute() {},
    focus() {},
    select() {},
    setSelectionRange(start, end) { this.selection = [start, end]; },
    remove() { this.removed = true; }
  };
  const document = {
    body: { append(node) { appended = node; } },
    createElement(tag) {
      assert.equal(tag, "textarea");
      return textarea;
    },
    execCommand(name) { command = name; return true; }
  };
  const context = {
    navigator: { clipboard: { async writeText() { throw new Error("denied"); } } },
    document
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  const result = await context.XPDFClipboard.copyText("print('x')");
  assert.equal(result, true);
  assert.equal(command, "copy");
  assert.equal(appended, textarea);
  assert.equal(textarea.value, "print('x')");
  assert.deepEqual(textarea.selection, [0, 10]);
  assert.equal(textarea.removed, true);
}

(async () => {
  await testClipboardApiPath();
  await testLegacyFallbackPath();
  console.log("clipboard-utils tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
