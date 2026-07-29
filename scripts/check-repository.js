const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), "manifest version must use x.y.z");
assert(manifest.default_locale === "en", "default_locale must be en");
assert(fs.existsSync(path.join(root, "_locales/en/messages.json")), "English locale is missing");
assert(fs.existsSync(path.join(root, "_locales/zh_CN/messages.json")), "Simplified Chinese locale is missing");

const referenced = [
  manifest.background?.service_worker,
  ...Object.values(manifest.icons || {}),
  "preview.html",
  "preview.css",
  "preview.js",
  "background.js",
  "extractor.js",
  "structured-parser.js",
  "formula-renderer.js",
  "code-highlighter.js",
  "clipboard-utils.js"
].filter(Boolean);
for (const relative of referenced) {
  assert(fs.existsSync(path.join(root, relative)), `Referenced file does not exist: ${relative}`);
}

const jsFiles = fs.readdirSync(root)
  .filter((name) => name.endsWith(".js"))
  .map((name) => path.join(root, name));
for (const file of jsFiles) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });

const forbiddenExtensions = new Set([".ttf", ".otf", ".woff", ".woff2"]);
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else assert(!forbiddenExtensions.has(path.extname(entry.name).toLowerCase()), `Do not commit font files: ${path.relative(root, full)}`);
  }
}
walk(root);

for (const locale of ["en", "zh_CN"]) {
  const messages = JSON.parse(fs.readFileSync(path.join(root, `_locales/${locale}/messages.json`), "utf8"));
  for (const key of ["appName", "appDescription", "actionTitle"]) {
    assert(typeof messages[key]?.message === "string" && messages[key].message.trim(), `${locale}/${key} is missing`);
  }
}

console.log(`Repository checks passed for X2PDF ${manifest.version}.`);
