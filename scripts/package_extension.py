#!/usr/bin/env python3
from pathlib import Path
import json, shutil, zipfile

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
version = manifest["version"]
DIST = ROOT / "dist"
STAGE = DIST / f"X2PDF-{version}"
ARCHIVE = DIST / f"X2PDF-v{version}.zip"

runtime_files = [
    "manifest.json", "background.js", "extractor.js", "structured-parser.js",
    "preview.html", "preview.css", "preview.js", "x2red-bridge.js", "i18n.js",
    "code-highlighter.js", "formula-renderer.js", "mathjax-config.js",
    "clipboard-utils.js", "LICENSE", "THIRD_PARTY_NOTICES.md"
]
runtime_dirs = ["icons", "vendor", "_locales"]

if DIST.exists():
    shutil.rmtree(DIST)
STAGE.mkdir(parents=True)

for relative in runtime_files:
    source = ROOT / relative
    if not source.exists():
        raise SystemExit(f"Missing runtime file: {relative}")
    target = STAGE / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)

for relative in runtime_dirs:
    source = ROOT / relative
    if not source.exists():
        raise SystemExit(f"Missing runtime directory: {relative}")
    shutil.copytree(source, STAGE / relative)

with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(STAGE.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(STAGE.parent))

print(ARCHIVE)
